// 변경점 카테고리 데이터입니다.
//
//   구동기        — GitHub 릴리스(pinnyangdev/lubit-engine)를 자동으로 받아옵니다. 여기 적지 않습니다.
//   클라이언트    — 아래 목록에 직접 적습니다.
//   디스코드 봇   — 아래 목록에 직접 적습니다.
//
// 두 제품은 릴리스 저장소가 없어, 새 버전을 올릴 때 이 목록에 한 항목씩 추가하는 방식입니다.
// 최신 항목이 맨 위에 오도록 정렬은 날짜로 자동으로 합니다.

export type ChangelogCategory = 'client' | 'engine' | 'bot'

export const CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  client: '클라이언트',
  engine: '구동기',
  bot: '디스코드 봇',
}

export const CATEGORY_ORDER: ChangelogCategory[] = ['client', 'engine', 'bot']

export type ChangelogEntry = {
  category: ChangelogCategory
  // 버전 표기입니다 — 구동기처럼 v0.1.14 처럼 써도 되고 날짜로 써도 됩니다.
  tag: string
  // ISO 날짜입니다. 예: '2026-11-01'
  publishedAt: string
  // 한 줄에 한 항목씩 적습니다. 줄바꿈으로 구분되어 그대로 각 줄로 보입니다.
  body: string
  // 있으면 카드 아래에 연결 링크가 생깁니다.
  url?: string
}

export const changelogEntries: ChangelogEntry[] = [
  // 예시 — 새 항목을 위에 추가하세요.
  // {
  //   category: 'client',
  //   tag: '1.2.0',
  //   publishedAt: '2026-11-01',
  //   body: '런처 시작 속도를 높였습니다.\n한글 폰트 깨짐을 수정했습니다.',
  // },
]
