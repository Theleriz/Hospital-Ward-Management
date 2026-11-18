"""T-29, Kazbekio: real UI delivery and unaccelerated escalation measurements.

No backend test client, mocked clock, timestamp ageing or direct escalation calls.
Owner SQL is only for fixtures, nurse availability and reading the audit journal.
"""
import asyncio
import csv
import json
import os
import platform
import re
import statistics
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from playwright.async_api import async_playwright, expect

OUT = Path('/results')
URL = os.environ['MEDBASE_TIMING_URL']
DB = os.environ['MEDBASE_TIMING_ADMIN_URL']
ROWS = []
PAGES = []
META = {
    'started_at': datetime.now(timezone.utc).isoformat(),
    'commit': os.environ.get('MEDBASE_COMMIT'),
    'source_dirty': os.environ.get('MEDBASE_SOURCE_DIRTY'),
    'python': platform.python_version(), 'playwright': '1.64.1',
    'poll_ms': 1000, 'worker_interval_seconds': 2, 'clock_accelerated': False,
    'delivery_method': 'controller perf_counter: outgoing simulator POST -> visible card (upper bound)',
    'escalation_method': 'PostgreSQL AlertEvent timestamps: CREATED -> ESCALATED, then ESCALATED -> ESCALATED',
    'environment': 'isolated Docker network, active headless Chromium pages, one ward; not a load test',
}


def query(sql, params=None):
    with psycopg.connect(DB) as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall() if cur.description else []


def record(kind, name, actual, passed, alert_id='', **extra):
    row = dict(kind=kind, name=name, actual=actual, passed=bool(passed), alert_id=alert_id, **extra)
    ROWS.append(row)
    print(f"{'PASS' if passed else 'FAIL'} {kind}: {name}: {actual}", flush=True)
    if not passed:
        raise AssertionError(f'{kind} {name}: {actual}')


def journal(alert_id):
    return query('SELECT "EventType", "NurseID", "OccurredAt" FROM "AlertEvent" '
                 'WHERE "AlertID" = %s ORDER BY "EventID"', (alert_id,))


async def station(browser, badge, pin, simulator=False):
    context = await browser.new_context(viewport={'width': 1400, 'height': 1000})
    await context.tracing.start(screenshots=True, snapshots=True)
    page = await context.new_page()
    PAGES.append((badge + ('-sim' if simulator else ''), page))
    await page.goto(URL)
    await page.get_by_label('Бейдж', exact=True).fill(badge)
    await page.get_by_label('PIN', exact=True).fill(pin)
    await page.get_by_role('button', name='Войти', exact=True).click()
    await expect(page.get_by_role('button', name='Выйти', exact=True)).to_be_visible()
    if simulator:
        await page.get_by_role('button', name='Симулятор устройств', exact=True).click()
        await expect(page.get_by_role('button', name='Создать оповещение', exact=True)).to_be_enabled()
    else:
        await page.get_by_role('button', name='Пост медсестры', exact=True).click()
        await expect(page.get_by_text('обновляется каждую секунду', exact=True)).to_be_visible()
    return page


async def raise_via_ui(sim, priority):
    await sim.get_by_label(re.compile('^Палата')).select_option('101')
    await sim.get_by_role('radio', name=re.compile('^' + priority + r'\b')).click()
    await sim.get_by_label('Описание (необязательно)', exact=True).fill('T29-' + uuid.uuid4().hex)
    started = []

    def on_request(request):
        if request.method == 'POST' and request.url.endswith('/api/simulator/alerts'):
            started.append(time.perf_counter())

    sim.on('request', on_request)
    try:
        async with sim.expect_response(lambda r: r.request.method == 'POST'
                                       and r.url.endswith('/api/simulator/alerts')) as result:
            await sim.get_by_role('button', name='Создать оповещение', exact=True).click()
        response = await result.value
        assert response.status == 201, f'Simulator returned {response.status}'
        body = await response.json()
        assert started, 'Outgoing simulator POST was not observed'
        return body['alert_id'], started[0]
    finally:
        sim.remove_listener('request', on_request)


def card(page, alert_id):
    return page.locator('article.alert').filter(has_text=alert_id)


async def acknowledge(page, alert_id):
    await card(page, alert_id).get_by_role('button', name='Подтвердить', exact=True).click()
    await expect(card(page, alert_id)).to_have_count(0)


async def escalation(sim, stations, priority):
    alert_id, _ = await raise_via_ui(sim, priority)
    # Eligible target on the same floor first; the other target is on another floor.
    for index, nurse_id in enumerate(('NURSE-04', 'NURSE-03'), start=1):
        recipient = stations[nurse_id]
        await expect(card(recipient, alert_id).locator('.escalated').first).to_contain_text(
            'эскалировано:', timeout=37000)
        events = journal(alert_id)
        escalated = [e for e in events if e[0] == 'ESCALATED']
        assert len(escalated) == index, events
        previous = next(e[2] for e in events if e[0] == 'CREATED') if index == 1 else escalated[-2][2]
        seconds = (escalated[-1][2] - previous).total_seconds()
        record('NFR-02', f'{priority} escalation {index}', seconds,
               30 <= seconds <= 35 and escalated[-1][1] == nurse_id,
               alert_id, expected='30..35 seconds', recipient=nurse_id)
        # UI text belongs to this recipient, not merely a row read from the database.
        record('recipient-screen', f'{priority} escalation {index}', nurse_id,
               await card(recipient, alert_id).is_visible(), alert_id)
    await acknowledge(stations['NURSE-03'], alert_id)


async def run(browser):
    query('TRUNCATE TABLE "AlertEvent", "WardAlert" RESTART IDENTITY')
    # NURSE-02 Busy, NURSE-05 OffShift: they must never receive an escalation.
    # Keep the head nurse Busy so recipients and their screen checks are deterministic.
    query('UPDATE "Nurse" SET "Status" = \'Busy\' WHERE "NurseID" = \'NURSE-10\'')
    sim = await station(browser, 'BADGE-1001', '1111', simulator=True)
    primary = await station(browser, 'BADGE-1001', '1111')
    recipients = {
        'NURSE-04': await station(browser, 'BADGE-1004', '4444'),
        'NURSE-03': await station(browser, 'BADGE-1003', '3333'),
    }
    for priority in ('LOW', 'HIGH', 'CRITICAL'):
        for offset in (0, .25, .5, .75):
            # Sample different phases after an actual workstation poll.
            await primary.wait_for_event('request', predicate=lambda r: r.url.endswith('/api/alerts'))
            await asyncio.sleep(offset)
            alert_id, start = await raise_via_ui(sim, priority)
            await card(primary, alert_id).wait_for(state='visible', timeout=5000)
            seconds = time.perf_counter() - start
            record('NFR-01', priority, round(seconds, 6), seconds <= 2,
                   alert_id, offset_seconds=offset, expected='<=2 seconds')
            await acknowledge(primary, alert_id)

    # Both negative controls remain under observation through the positive cases (>60 s).
    low_id, _ = await raise_via_ui(sim, 'LOW')
    ack_id, _ = await raise_via_ui(sim, 'HIGH')
    await card(primary, ack_id).wait_for(state='visible')
    await acknowledge(primary, ack_id)
    for priority in ('HIGH', 'CRITICAL'):
        await escalation(sim, recipients, priority)
    for name, alert_id in [('LOW', low_id), ('acknowledged', ack_id)]:
        events = journal(alert_id)
        record('negative', name, len([e for e in events if e[0] == 'ESCALATED']),
               not any(e[0] == 'ESCALATED' for e in events), alert_id)
    record('negative', 'Busy/OffShift recipients', query(
        'SELECT COUNT(*) FROM "AlertEvent" WHERE "EventType" = \'ESCALATED\' '
        'AND "NurseID" IN (\'NURSE-02\', \'NURSE-05\', \'NURSE-10\')')[0][0],
        not query('SELECT 1 FROM "AlertEvent" WHERE "EventType" = \'ESCALATED\' '
                  'AND "NurseID" IN (\'NURSE-02\', \'NURSE-05\', \'NURSE-10\')'))
    await acknowledge(primary, low_id)

    query('UPDATE "Nurse" SET "Status" = \'Busy\' WHERE "NurseID" IN (\'NURSE-03\', \'NURSE-04\')')
    unavailable_id, _ = await raise_via_ui(sim, 'HIGH')
    await asyncio.sleep(36)
    state = query('SELECT "Status", "EscalatedToNurseID" FROM "WardAlert" WHERE "AlertID" = %s',
                  (unavailable_id,))[0]
    record('negative', 'no Available: stays pending (not a timing success)', str(state),
           state == ('PENDING', None) and not any(e[0] == 'ESCALATED' for e in journal(unavailable_id)),
           unavailable_id)
    await acknowledge(primary, unavailable_id)


def save(error):
    META['finished_at'] = datetime.now(timezone.utc).isoformat()
    deliveries = [r['actual'] for r in ROWS if r['kind'] == 'NFR-01']
    summary = dict(samples=len(deliveries), min=min(deliveries), median=statistics.median(deliveries),
                   max=max(deliveries)) if deliveries else {}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'results.json').write_text(json.dumps(dict(metadata=META, summary=summary,
        passed=error is None, error=error, measurements=ROWS), ensure_ascii=False, indent=2), encoding='utf-8')
    keys = sorted({k for row in ROWS for k in row})
    with (OUT / 'measurements.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=keys or ['name'])
        writer.writeheader()
        writer.writerows(ROWS)
    lines = ['# T-29 — фактические измерения', '', f"Commit: `{META['commit']}`; dirty: {META['source_dirty']}",
             f"Result: {'PASS' if error is None else 'FAIL'}", '',
             f'Метод: {META["delivery_method"]}', f'Среда: {META["environment"]}',
             f'Доставка (секунды): {summary}', '', '| Проверка | Значение | Результат |', '|---|---|---|']
    lines += [f"| {r['kind']}: {r['name']} | {r['actual']} | {'PASS' if r['passed'] else 'FAIL'} |" for r in ROWS]
    if error:
        lines += ['', f'Ошибка: {error}']
    (OUT / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


async def main():
    error = None
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'])
        META['chromium'] = browser.version
        try:
            await run(browser)
        except Exception as exc:
            error = f'{type(exc).__name__}: {exc}'
            print(error, flush=True)
        finally:
            for name, page in PAGES:
                try:
                    if error:
                        await page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)
                    await page.context.tracing.stop(path=str(OUT / f'{name}-trace.zip'))
                except Exception:
                    pass
            save(error)
            await browser.close()
    if error:
        raise SystemExit(1)
    print('PASS: NFR-01/NFR-02; results in artifacts/alert-timing/', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
