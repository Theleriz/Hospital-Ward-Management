"""Publish the three prepared branches/PRs and anchored reviews using normal Git auth.

Dry run is the default. --publish uses only the configured `git credential fill`
helper; no credential files are read and no token is printed or stored.
Never merges PRs or changes main. Run in the user's authenticated VS Code terminal.
"""
import argparse
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Theleriz/Hospital-Ward-Management'
BRANCHES = [
    ('docs/t36-polling-architecture', 'T-36/T-30: polling decision and current architecture',
     'Documents one-second polling and its timing budget, updates architecture and task ownership, '
     'and adds the UC-8 sequence diagram. A one-second interval is not presented as measured proof. '
     'Validation: diff/link checks and Mermaid parsing. No runtime changes.'),
    ('test/t29-alert-timing', 'T-29: real browser alert delivery and escalation timing',
     'Adds an isolated Docker/Chromium measurement command: bash scripts/check-alert-timing.sh. '
     'Checks 12 deliveries <=2 seconds, real first/repeat HIGH and CRITICAL escalations at 30..35 seconds, '
     'and negative controls. Results and method: docs/testing/alert-timing-report.md. '
     'Merge after the T-36/T-30 documentation PR; includes its commit.'),
    ('feature/t48-persistent-login-lockout', 'T-48: persistent atomic PIN lockout in PostgreSQL',
     'Moves login attempts and lockout to PostgreSQL with per-badge row locks and DB time. '
     'Commits failed attempts before HTTP errors, revokes the raw verifier, preserves the 401/429 contract, '
     'and includes an additive migration. Two real backend restarts are checked by '
     'bash scripts/check-login-lockout.sh. Tests and rollout: docs/testing/login-lockout-report.md. '
     'Includes preceding T-36 and T-29 work; merge after those PRs. SQL review by Nurali required. '
     'CSRF is deferred as agreed.'),
]
REVIEWS = [
    (19, '02d44f86a86cb708e515d0471d6235bfda2dd73e', 'COMMENT', 'docs/reviews/pr19.md'),
    (20, '11353f103ebc1532f469e1e4b1ac92d3130b44ae', 'REQUEST_CHANGES', 'docs/reviews/pr20.md'),
]


def git(*args, **kwargs):
    return subprocess.run(['git', '-C', str(ROOT), *args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true', help='Push branches, create PRs and submit prepared reviews')
    args = parser.parse_args()
    for branch, title, _ in BRANCHES:
        git('rev-parse', '--verify', 'refs/heads/' + branch, stdout=subprocess.DEVNULL)
        print(f'{branch}: {title}', flush=True)
    if not args.publish:
        print('Dry run. Use --publish in your authenticated VS Code terminal. No merge will be performed.')
        return
    remote = git('remote', 'get-url', 'origin', capture_output=True, text=True).stdout.strip()
    if remote not in (f'https://github.com/{REPO}.git', f'https://github.com/{REPO}'):
        raise SystemExit('Unexpected origin; publication cancelled.')
    credentials = git('credential', 'fill', input=f'url=https://github.com/{REPO}.git\n\n',
                      capture_output=True, text=True).stdout
    fields = dict(line.split('=', 1) for line in credentials.splitlines() if '=' in line)
    token = fields.get('password')
    if not token:
        raise SystemExit('Configured Git credential helper returned no credential. Use an authenticated VS Code terminal.')

    def api(path, body=None):
        request = urllib.request.Request(f'https://api.github.com{path}',
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'User-Agent': 'MedBase-Kazbek-Publisher'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f'GitHub HTTP {exc.code} for {path}; no credential was logged.') from None

    if api('/user').get('login', '').lower() != 'kazbekio':
        raise SystemExit('Expected GitHub account Kazbekio. Publication cancelled.')
    result = {'pull_requests': [], 'reviews': []}
    for branch, title, body in BRANCHES:
        git('push', '-u', 'origin', branch)
        query = urllib.parse.urlencode({'state': 'open', 'head': 'Theleriz:' + branch})
        prs = api(f'/repos/{REPO}/pulls?{query}')
        pr = prs[0] if prs else api(f'/repos/{REPO}/pulls', dict(title=title, head=branch, base='main', body=body))
        result['pull_requests'].append(pr['html_url'])
        print(pr['html_url'], flush=True)
        if branch == 'feature/t48-persistent-login-lockout':
            requested = {u['login'].lower() for u in pr.get('requested_reviewers', [])}
            reviewers = [u for u in ('Nurali-Zhanserik', 'Theleriz') if u.lower() not in requested]
            if reviewers:
                api(f'/repos/{REPO}/pulls/{pr["number"]}/requested_reviewers', dict(reviewers=reviewers))
    for number, sha, event, file in REVIEWS:
        pr = api(f'/repos/{REPO}/pulls/{number}')
        if pr['state'] != 'open' or pr['head']['sha'] != sha:
            print(f'PR #{number} changed or closed; a fresh review is required. Prepared review not posted.')
            continue
        marker = f'Architecture & Security review by Kazbekio ({sha[:7]})'
        previous = api(f'/repos/{REPO}/pulls/{number}/reviews?per_page=100')
        if any(r['user']['login'].lower() == 'kazbekio' and marker in (r.get('body') or '') for r in previous):
            print(f'PR #{number}: matching review already exists; skipped.')
            continue
        body = (ROOT / file).read_text(encoding='utf-8').split('\nПубликация review')[0]
        review = api(f'/repos/{REPO}/pulls/{number}/reviews',
                     dict(commit_id=sha, event=event, body=marker + '\n\n' + body))
        result['reviews'].append(review['html_url'])
        print(review['html_url'], flush=True)
    target = ROOT / 'artifacts' / 'publication.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('Published. Wait for all four CI checks; Theleriz performs merges.')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from None
    except subprocess.CalledProcessError as exc:
        # Never print subprocess output: the credential helper can return secrets.
        raise SystemExit(f'Publication stopped ({type(exc).__name__}). Branches/PRs already published are safe to retry.') from None
