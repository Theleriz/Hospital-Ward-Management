"""HTTP checks for check-login-lockout.sh. Uses only the Python standard library."""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

phase = sys.argv[1]
path = Path('/results/restart.json')
results = [] if phase == 'before' else json.loads(path.read_text(encoding='utf-8'))


def login(badge, pin, expected):
    request = urllib.request.Request('http://backend:8000/api/auth/login',
        data=json.dumps(dict(badge_id=badge, pin=pin)).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        actual = response.status
        retry = response.headers.get('Retry-After')
        passed = actual == expected and (actual != 429 or 1 <= int(retry or '0') <= 300)
        results.append(dict(phase=phase, badge=badge, expected=expected, actual=actual,
            retry_after=retry, passed=passed, time=datetime.now(timezone.utc).isoformat()))
        path.write_text(json.dumps(results, indent=2), encoding='utf-8')
        print(f'{phase}: {badge}: expected {expected}, actual {actual}', flush=True)
        assert passed, 'Login contract differs; see restart.json'


if phase == 'before':
    for _ in range(5):
        login('BADGE-1001', '0000', 401)
    login('BADGE-1001', '1111', 429)
    for _ in range(4):
        login('BADGE-1004', '0000', 401)
elif phase == 'after':
    login('BADGE-1001', '1111', 429)
    login('BADGE-1004', '0000', 401)
    login('BADGE-1004', '4444', 429)
elif phase == 'final':
    login('BADGE-1001', '1111', 429)
    login('BADGE-1004', '4444', 429)
    login('BADGE-2001', '2001', 200)
elif phase == 'expired':
    login('BADGE-1001', '1111', 200)
    login('BADGE-1004', '4444', 200)
else:
    raise SystemExit('Unknown check phase')
