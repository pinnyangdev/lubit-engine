# SaaS landing page

A dark, animated marketing page for a software product: hero with a live
product mock, logo cloud, feature bento, how it works, a tabbed showcase,
metrics, testimonials, pricing with a billing toggle, FAQ, email capture and
footer. Every section is its own component and all copy lives in one file.

## Run it

```sh
bun install
bun run dev        # http://localhost:5173 (Vite + the Worker in workerd)
bun run build      # dist/client (assets) + dist/saas_landing/index.js (Worker)
```

## Edit it

- `src/content.ts` holds every string, price and link. Start there.
- `src/sections/*` are the page sections. `src/App.tsx` stacks them; delete or
  reorder lines there to remove or move a section.
- `src/styles.css` holds the design tokens (colours, radii, fonts, keyframes).
  Everything rounded is a squircle via `corner-shape`; true circles use `.round`.
  Bordered surfaces use the `depth` utility instead of a border: an inset edge
  plus a top highlight, the same treatment as the Freebuff desktop app. The
  element must be positioned; recolour the edge with `--depth-edge`.
- `src/worker/index.ts` is the Cloudflare Worker. `/api/subscribe` receives the
  email form; connect it to your provider or a D1 table.

## Deploy with Freebuff Sites

`deploy.json` already points at the build output. After `bun run build`, deploy
it with the `sites_deploy` tool (or the Sites API) from this directory.

## 업데이트 내역

릴리스를 올릴 때마다 `RELEASE_NOTES.md` 에서 자동으로 기록됩니다.

<!-- lubit-changelog:start -->

### 0.1.13 — 2026-10-31

- **설치판 실행 불가 버그 수정** — 빌드 설정(`build.files`)에서 `backup.js`,
  `prefs.js`, `import.js`, `zip.js` 네 파일이 빠져 있어, 설치판을 켜면
  `Cannot find module './backup'` 오류로 바로 종료됐습니다.
- 백업 · 백업 복원 · 앱 설정 · 서버 가져오기 기능이 설치판에서 정상 동작합니다.
- 자동 업데이트가 새 버전을 받을 수 있도록 버전을 올렸습니다.

<!-- lubit-changelog:end -->
