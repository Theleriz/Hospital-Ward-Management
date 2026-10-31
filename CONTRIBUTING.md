# Правила работы с репозиторием

Эти правила обязательны для всех участников Team MedBase. Короткая версия продублирована в [README.md](README.md#правила-работы-с-репозиторием).

## 1. Ветка `main` всегда готова к демо

В любой момент из `main` должно быть можно показать корректно работающий проект.

`main` считается готовой к демо, если на чистой базе проходят все три проверки:

```bash
# 1. База собирается с нуля
docker compose down -v
docker compose up -d --wait

# 2. Автотесты проходят (в конце "ALL TESTS PASSED")
docker exec medbase-postgres psql -U medbase -d hospital_ward -v ON_ERROR_STOP=1 -f /db/tests/test_hospital_ward.sql

# 3. Демо отрабатывает до конца
docker exec -it medbase-postgres psql -U medbase -d hospital_ward -f /db/demo.sql
```

- Незаконченная или непроверенная работа в `main` не попадает: она живёт в своей ветке, пока не пройдёт все три проверки.
- Новая таблица, процедура или правило добавляются вместе с тестами в `db/tests/test_hospital_ward.sql`. Если меняется поведение, которое видно в демо, обновляется `db/demo.sql`.
- Если `main` сломалась, её починка важнее любой другой работы.

## 2. Все изменения — через Pull Request

- Любое изменение (код, SQL, документы) попадает в `main` только через Pull Request (PR).
- Прямой push в `main` запрещён.
- **Исключение:** только `theleriz` (zanatrisat54@gmail.com) может пушить в `main` напрямую. Правило 1 действует и для него.
- В описании PR указывается, что изменено и как это проверить. Перед слиянием автор отмечает чек-лист из шаблона PR.

## 3. Начинать работу от свежей `main`

Перед началом работы над новой функциональностью или новым документом обновите `main` и создайте ветку от неё, чтобы не было рассинхрона:

```bash
git checkout main
git pull origin main
git checkout -b feature/doctor-table
```

Именование веток:

| Префикс | Для чего | Пример |
|---|---|---|
| `feature/` | новая функциональность | `feature/bed-table` |
| `fix/` | исправление ошибки | `fix/ward-capacity-check` |
| `docs/` | документы и описания | `docs/task-10-report` |

Если пока вы работали, `main` ушла вперёд, подтяните её в свою ветку перед открытием PR:

```bash
git checkout main
git pull origin main
git checkout feature/doctor-table
git merge main
```
