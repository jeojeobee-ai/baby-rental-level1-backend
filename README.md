# 햇빛구 육아용품 대여실 — 백엔드 (NestJS + PostgreSQL)

API B1~B7과 입력 규칙, "지금 상태" 계산은 `기획서.md` 6~8장을 따릅니다. 모든 데이터는 가상입니다.

## 내 컴퓨터에서 실행

```bash
npm install
cp .env.example .env          # DATABASE_URL에 DB 주소를 넣으세요
npx prisma migrate deploy     # 테이블 3개 만들기
npm run seed                  # 가상 데이터 넣기 (DB가 비어 있을 때만)
npm run build && npm start    # http://localhost:4000
```

- `npm run seed -- --reset`은 기존 용품·대여·소독 기록을 **모두 지우고** 다시 넣습니다.
- `.env`는 GitHub에 올라가지 않습니다.

## API

| 번호 | 요청 | 설명 |
|---|---|---|
| B1 | `GET /health` | DB 연결 확인 |
| B2 | `GET /items` | 용품 목록 + 지금 상태 |
| B3 | `GET /items/:id` | 용품 상세 + 대여·소독 기록 |
| B4 | `POST /items` | 용품 등록 |
| B5 | `POST /items/:id/rentals` | 대여 기록 등록 |
| B6 | `PATCH /rentals/:id/return` | 반납 처리 |
| B7 | `POST /items/:id/sanitizations` | 소독 기록 등록 |

잘못된 입력은 400과 `{ "errors": { "칸이름": "안내 문구" } }`로 돌려줍니다.
