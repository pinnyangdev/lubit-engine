// All copy lives here so the page can be re-themed for a product without
// touching layout. Sections read from this file; remove a section by deleting
// it from App.tsx.

export const brand = {
  name: 'Lubit',
  tagline: '루빗 스튜디오',
}

// The address the live status widgets read from. Leave empty to hide them.
export const server = {
  host: 'mc.lubit.kr',
}

export const nav = {
  links: [
    { label: '서비스', href: '/#services' },
    { label: '진행 방식', href: '/#how' },
    { label: '견적 안내', href: '/#pricing' },
    { label: '변경점', href: '/changelog' },
    { label: '문의', href: '/support' },
  ],
  signIn: { label: '디스코드', href: 'https://discord.gg/3tpscUy32u' },
  cta: { label: '견적 문의', href: '/support' },
}

// Each service is its own page under the one domain: /client, /engine, ...
// The home page links here; ServicePage renders the detail.
export const services = [
  {
    slug: 'mc-server',
    name: '마크 서버',
    kind: '직접 운영',
    eyebrow: '서비스 01 · 마크 서버',
    title: '직접 운영하는 마크 서버',
    highlight: '직접 운영하는',
    description:
      '루빗이 직접 셋업하고 운영하는 마크 서버입니다. 오픈 일정과 접속 주소는 이 페이지에서 가장 먼저 공개합니다.',
    price: { label: '오픈 준비 중', note: '접속 주소 공개 시 안내' },
    cta: { label: '서버 접속하기', href: '/mc-server/join' },
    points: [
      { title: '직접 셋업', description: '서버 구성과 플러그인은 전부 직접 골라 올립니다.' },
      { title: '규칙 공개', description: '제재 기준과 운영 방침을 서버 페이지에 미리 공개합니다.' },
      { title: '접속 안내', description: '오픈 일정과 접속 주소, 업데이트 소식을 한 곳에서 알려드립니다.' },
    ],
    includes: [
      '서버 셋업 및 플러그인 구성',
      '커뮤니티 규칙 공개',
      '오픈 일정 공지',
      '접속 주소 안내',
      '이벤트 · 업데이트 공지',
      '유저 문의 채널',
    ],
    faq: [
      {
        q: '언제 열리나요?',
        a: '셋업과 점검이 끝나는 대로 오픈 일정을 이 페이지와 디스코드 공지에 함께 올립니다.',
      },
      {
        q: '어떤 버전으로 운영되나요?',
        a: '접속자가 가장 많은 버전을 기준으로 정하고, 필요한 플러그인 호환성을 확인한 뒤 알려드립니다.',
      },
      {
        q: '유저로 참여할 수 있나요?',
        a: '네. 접속 주소가 공개되면 누구나 접속할 수 있습니다. 참여 조건은 규칙 문서에 정리해 두겠습니다.',
      },
    ],
  },
  {
    slug: 'outsourcing',
    name: '시스템 외주',
    kind: '외주 의뢰',
    eyebrow: '서비스 02 · 시스템 외주',
    title: '필요한 시스템, 대신 만들어 드립니다',
    highlight: '대신 만들어',
    description:
      '마크 서버 셋업과 커스텀 프로그램, 운영 도구, 봇 연동까지. 만드는 데 시간을 쓰고 싶지 않다면 범위부터 함께 정합니다.',
    price: { label: '상담 후 견적', note: '범위 확정 후 고정 견적' },
    cta: { label: '견적 문의하기', href: '/support' },
    points: [
      { title: '범위 정의', description: '무엇을 만들지 함께 정리하고, 만들지 말아야 할 부분도 솔직히 말씀드립니다.' },
      { title: '반복 시연', description: '작업 중간마다 확인할 수 있게 만들어 두고 방향을 바로잡습니다.' },
      { title: '납품 후 지원', description: '배포 이후에도 수정과 버그 수정을 함께 진행합니다.' },
    ],
    includes: [
      '마크 서버 셋업 · 플러그인 구성',
      '커스텀 프로그램 · 도구 제작',
      '봇 · 시스템 연동',
      '데이터 정리 및 이관',
      '테스트 환경 제공',
      '소스코드 및 배포 지원',
    ],
    faq: [
      {
        q: '무엇을 맡길 수 있나요?',
        a: '마크 서버 셋업, 커스텀 프로그램과 도구, 봇·서비스 연동까지. 만들고 싶은 게 있으면 상담부터 시작하면 됩니다.',
      },
      {
        q: '기간은 얼마나 걸리나요?',
        a: '셋업만 필요한 경우 3~7일, 커스텀 요소가 포함되면 2~4주가량 걸립니다. 착수 전에 일정을 문서로 드립니다.',
      },
      {
        q: '납품 후에도 봐주시나요?',
        a: '네. 버그 수정은 납품 후에도 진행하며, 이후 업데이트와 기능 추가는 유지보수 계약으로 이어 받습니다.',
      },
    ],
  },
  {
    slug: 'client',
    name: '마크 클라이언트',
    kind: '직접 제작 · 무료',
    eyebrow: '서비스 03 · 마크 클라이언트',
    title: '완벽한 최적화 Lubit 클라이언트',
    highlight: '완벽한 최적화',
    description:
      '루빗이 직접 개발하고 배포하는 마크 클라이언트입니다. 무료로 받아 쓸 수 있고, 새 버전은 자동으로 내려받습니다.',
    price: { label: '무료로 배포', note: '다운로드 · 자동 업데이트' },
    cta: { label: '다운로드', href: '#' },
    points: [
      { title: '전용 런처', description: '로그인과 게임 실행, 모드 관리를 하나의 실행 파일로 처리합니다.' },
      { title: '성능 최적화', description: '불필요한 프로세스를 걷어내고 프레임을 안정적으로 유지합니다.' },
      { title: '자동 업데이트', description: '새 버전이 나오면 유저가 따로 받지 않도록 자동으로 적용됩니다.' },
    ],
    includes: [
      '런처 · 계정 로그인',
      '모드 및 플러그인 번들',
      '스킨 · OSD · HUD',
      '성능 최적화 빌드',
      '자동 업데이트 배포',
      '패치 및 유지보수',
    ],
    faq: [
      {
        q: '무료로 쓸 수 있나요?',
        a: '네. 다운로드 후 바로 쓸 수 있으며 별도 비용은 없습니다.',
      },
      {
        q: '어떤 기능이 들어있나요?',
        a: '런처, 모드, 스킨, HUD, 성능 최적화 기능을 포함합니다. 쓰지 않는 기능은 꺼 둘 수 있습니다.',
      },
      {
        q: '업데이트는 어떻게 받나요?',
        a: '런처가 새 버전을 확인하면 자동으로 내려받아 적용합니다. 문제가 생기면 디스코드로 알려주세요.',
      },
    ],
  },
  {
    slug: 'engine',
    name: '서버 구동기',
    kind: '직접 제작',
    eyebrow: '서비스 04 · 서버 구동기',
    title: '여러 서버를 한 번에 여는 구동기',
    highlight: '여러 서버를',
    description:
      '루빗이 직접 만드는 서버 구동기입니다. 다수의 마크 서버를 한 화면에서 켜고 끄고 관리하며, 자동 재시작과 로그 수집까지 포함합니다.',
    price: { label: '무료로 사용', note: '다운로드 후 바로 사용' },
    cta: { label: '다운로드', href: '/download/engine' },
    // 누르면 윈도우·안드로이드·iOS 중 무엇을 받을지 고르게 합니다.
    downloadChooser: true,
    secondary: { label: '콘솔 이동하기', href: '/console' },
    points: [
      { title: '다중 서버', description: '여러 서버 프로세스를 한 목록에서 관리합니다.' },
      { title: '자동 복구', description: '꺼지면 자동으로 다시 켜고, 실패 이력을 남깁니다.' },
      { title: '로그 수집', description: '콘솔 출력을 모아두어 문제 발생 시 바로 돌아볼 수 있습니다.' },
    ],
    includes: [
      '서버 프로세스 실행 · 종료',
      '원클릭 전체 시작',
      '자동 재시작 및 장애 복구',
      '콘솔 로그 수집 · 검색',
      'CPU · 메모리 사용량 표시',
      '계정 및 권한 관리',
    ],
    faq: [
      {
        q: '어떤 제품인가요?',
        a: '서버 프로세스를 켜고 끄고 관리하는 도구입니다. 여러 대를 한 화면에서 다루고, 꺼지면 자동으로 다시 켭니다.',
      },
      {
        q: '기존 서버 환경에 붙일 수 있나요?',
        a: '됩니다. 현재 쓰는 서버 배치 방식을 확인한 뒤, 그대로 붙일 수 있는 형태로 구성합니다.',
      },
      {
        q: '서버가 꺼져도 알림을 받을 수 있나요?',
        a: '네. 디스코드 웹훅이나 봇 알림으로 바로 전달하도록 연결할 수 있습니다.',
      },
    ],
  },
  {
    slug: 'bot',
    name: '디스코드 봇',
    kind: '직접 운영 · 무료',
    eyebrow: '서비스 05 · 디스코드 봇',
    title: '한 마리로 끝내는 다용도봇',
    highlight: '다용도봇',
    description:
      '루빗이 직접 운영하는 다용도봇입니다. 공지, 티켓, 추첨, 인증, 서버 상태 알림을 하나에 담았고 무료로 쓸 수 있습니다.',
    price: { label: '무료로 사용', note: '디스코드에 초대해 사용' },
    cta: { label: '봇 초대하기', href: '#' },
    points: [
      { title: '다용도', description: '여러 봇을 나눠 쓰지 않고 한 마리에 기능을 모았습니다.' },
      { title: '자동 알림', description: '공지 예약과 서버 켜짐, 점검 시작을 자동으로 전송합니다.' },
      { title: '보안 인증', description: '가입 인증과 역할 부여를 자동화해 스팸을 막습니다.' },
    ],
    includes: [
      '공지 예약 · 자동 전송',
      '티켓 문의 시스템',
      '닉네임 · 가입 인증',
      '추첨 · 투표 · 대기열',
      '서버 상태 알림 연동',
      '웹훅 및 결제 연동',
    ],
    faq: [
      {
        q: '무료로 쓸 수 있나요?',
        a: '네. 디스코드에 초대하면 바로 쓸 수 있으며, 기능은 서버에 필요한 것만 켜서 사용합니다.',
      },
      {
        q: '어떤 기능이 들어있나요?',
        a: '공지 예약, 티켓 문의, 닉네임 인증, 추첨, 서버 상태 알림을 기본으로 지원합니다.',
      },
      {
        q: '요구하는 기능이 없으면 어떻게 하나요?',
        a: '필요한 기능을 알려주시면 다용도봇에 추가할지, 별도로 만드는 편이 나을지 함께 판단해 드립니다.',
      },
    ],
  },
  {
    slug: 'website',
    name: '웹사이트 외주',
    kind: '외주 의뢰',
    eyebrow: '서비스 06 · 웹사이트',
    title: '서버와 서비스를 보여주는 웹사이트',
    highlight: '웹사이트',
    description:
      '규칙, 서버 정보, 스토어, 접속 버튼까지 담습니다. 모바일에서도 빠르게 열리고 도메인 연결까지 처리합니다.',
    price: { label: '상담 후 견적', note: '제작 · 도메인 연결 포함' },
    cta: { label: '견적 문의하기', href: '/support' },
    points: [
      { title: '모바일 우선', description: '유저 대부분이 폰으로 접속하니 작은 화면 기준으로 먼저 맞춥니다.' },
      { title: '한눈에 규칙', description: '서버 규칙과 콘텐츠를 정리해 가입 전 이탈을 줄입니다.' },
      { title: '바로 연결', description: 'IP 복사, 접속 버튼, 후원 · 스토어 링크를 바로 붙입니다.' },
    ],
    includes: [
      '메인 · 규칙 · 소개 페이지',
      '서버 상태 및 접속 버튼',
      '스토어 · 후원 페이지 연결',
      '공지 · 업데이트 게시판',
      '반응형 모바일 대응',
      '도메인 · SSL 설정 지원',
    ],
    faq: [
      {
        q: '도메인도 사 주나요?',
        a: '원하시면 등록 절차를 안내해 드립니다. 이미 가지고 계신 도메인이 있다면 연결만 진행합니다.',
      },
      {
        q: '나중에 내용을 직접 바꿀 수 있나요?',
        a: '네. 공지와 규칙처럼 자주 바뀌는 부분은 관리자가 수정할 수 있게 구성합니다.',
      },
      {
        q: '기간은 얼마나 걸리나요?',
        a: '정적인 소개 사이트는 3~7일, 스토어나 게시판이 포함되면 2~4주가량 걸립니다.',
      },
    ],
  },
]

// 일부 서비스에만 붙는 선택 항목 (콘솔 바로가기, 플랫폼 선택 다운로드).
type OptionalServiceFields = {
  secondary?: { label: string; href: string }
  downloadChooser?: boolean
}

export type Service = (typeof services)[number] & OptionalServiceFields

export const hero = {
  badge: '마크 서버 · 클라이언트 · 웹사이트 외주',
  title: ['만드는 일은 전부,', 'lubit에 맡기세요'],
  highlight: 'lubit',
  description:
    '시스템 외주와 웹사이트 외주, 마크 클라이언트, 서버 구동기, 디스코드 봇까지. 기획부터 제작·배포·유지보수까지 한 팀이 끝까지 맡습니다.',
  secondary: { label: '서비스 살펴보기', href: '#services' },
  footnote: '문의 남기시면 24시간 안에 회신드립니다. 상담·견적은 무료입니다.',
}

export const logos = ['Minecraft', 'Paper', 'Velocity', 'Discord', 'Node.js', 'Docker', 'Cloudflare', 'Python']

export const features = {
  eyebrow: '주요 서비스',
  title: '이런 작업이 가장 많이 들어옵니다',
  description: '네 가지를 자주 맡습니다. 나머지는 전체 서비스에서 확인하세요.',
  items: [
    {
      key: 'outsourcing',
      title: '시스템 외주',
      description: '마크 서버 셋업부터 커스텀 프로그램, 운영 도구까지 대신 만들어 드립니다.',
      href: '/outsourcing',
      span: 2,
    },
    {
      key: 'engine',
      title: '서버 구동기',
      description: '여러 서버를 한 화면에서 켜고 끄고 관리하는 구동기.',
      href: '/engine',
      span: 1,
    },
    {
      key: 'bot',
      title: '디스코드 봇',
      description: '공지·티켓·추첨·인증을 한 마리에 담은 다용도봇.',
      href: '/bot',
      span: 1,
    },
    {
      key: 'client',
      title: '마크 클라이언트',
      description: '런처와 모드, 성능 최적화를 담은 자체 클라이언트를 배포까지.',
      href: '/client',
      span: 2,
    },
  ],
}

export const steps = {
  eyebrow: '진행 방식',
  title: '문의부터 납품까지 3단계',
  items: [
    {
      title: '상담 · 견적',
      description: '무엇을 만들지 알려주시면 범위와 일정, 비용을 정리해 드립니다.',
    },
    {
      title: '제작 · 시연',
      description: '요구사항대로 만들고 중간마다 확인하며 방향을 바로잡습니다.',
    },
    {
      title: '납품 · 유지보수',
      description: '배포 이후에도 수정과 업데이트를 같은 팀에서 이어 받습니다.',
    },
  ],
}

// 신규 사업이라 검증되지 않은 실적 수치는 쓰지 않습니다.
// 각 항목은 약속하거나 구조적으로 사실인 값만 넣었습니다.
export const metrics: { value: number; suffix: string; label: string; decimals?: number }[] = [
  { value: 24, suffix: '시간', label: '이내 견적 회신' },
  { value: 6, suffix: '개', label: '전문 서비스 항목' },
  { value: 3, suffix: '단계', label: '간단한 진행 절차' },
  { value: 24, suffix: '시간', label: '환불 보장 기간' },
]

// 실제 의뢰 이력이 생기기 전이라 후기가 아니라 작업 범위를 보여줍니다.
export const testimonials = {
  eyebrow: '작업 범위',
  title: '이런 작업을 맡습니다',
  items: [
    {
      quote: '마크 서버 셋업, 커스텀 프로그램, 운영 도구, 봇 연동까지 범위를 정하고 고정 견적으로 제작합니다.',
      name: '시스템 외주',
      role: '프로그램 · 시스템 제작',
      icon: 'wrench',
    },
    {
      quote: '직접 개발한 런처와 모드, 성능 최적화를 담아 배포하고, 새 버전은 자동 업데이트로 내려보냅니다.',
      name: '마크 클라이언트',
      role: '직접 제작 · 무료 배포',
      icon: 'monitor',
    },
    {
      quote: '여러 서버를 한 번에 켜고 끄는 구동기를 만들고, 꺼지면 자동으로 복구되도록 구성합니다.',
      name: '서버 구동기',
      role: '프로세스 관리 도구',
      icon: 'server',
    },
    {
      quote: '루빗이 직접 운영하는 다용도봇에 공지 예약, 티켓, 인증, 상태 알림을 담아 무료로 제공합니다.',
      name: '디스코드 봇',
      role: '직접 운영 · 무료',
      icon: 'bot',
    },
    {
      quote: '규칙과 스토어, 접속 버튼을 담은 모바일 친화 사이트를 만들고 도메인 연결까지 처리합니다.',
      name: '웹사이트',
      role: '소개 · 스토어',
      icon: 'globe',
    },
    {
      quote: '직접 운영하는 마크 서버의 셋업과 규칙 정리, 오픈 일정 안내를 한 곳에서 진행합니다.',
      name: '마크 서버',
      role: '자체 서버 운영',
      icon: 'game',
    },
  ],
}

export const pricing = {
  eyebrow: '견적 안내',
  title: '범위가 정해지면 금액이 정해집니다',
  description: '외주 작업은 범위를 확인하고 고정 견적을 드립니다. 직접 만드는 제품은 이 방식과 따로 안내합니다.',
  tiers: [
    {
      name: '단순 수정 · 소규모',
      price: '상담 후 견적',
      note: '당일 ~ 3일',
      description: '범위가 분명한 작은 작업. 확인하면 바로 안내드립니다.',
      cta: '문의하기',
      features: ['범위 확인 후 즉시 안내', '작은 요청도 진행', '수정 1회 포함'],
    },
    {
      name: '표준 프로젝트',
      price: '상담 후 견적',
      note: '1 ~ 4주',
      description: '웹사이트 외주, 프로그램 제작처럼 한 건을 끝까지.',
      cta: '문의하기',
      popular: true,
      features: ['요구사항 문서화', '중간 시연 포함', '납품 후 버그 수정', '소스코드 전달'],
    },
    {
      name: '대형 · 상시 진행',
      price: '상담 후 견적',
      note: '일정 협의',
      description: '마크 클라이언트, 서버 구동기처럼 규모가 큰 작업.',
      cta: '문의하기',
      features: ['단계별 일정 계획', '전담 엔지니어 배정', '배포 · 업데이트 지원', '유지보수 계약 가능'],
    },
  ],
}

export const faq = {
  title: '자주 묻는 질문',
  items: [
    {
      q: '어떤 작업을 맡을 수 있나요?',
      a: '시스템 외주와 웹사이트 외주를 주로 맡고, 마크 클라이언트·서버 구동기·디스코드 봇은 직접 만들어 무료로 공개합니다. 그 외 요청도 상담에서 가능 여부를 먼저 확인합니다.',
    },
    {
      q: '견적은 언제 받을 수 있나요?',
      a: '문의 주시면 24시간 안에 회신합니다. 원하는 내용이 아직 정리되지 않았어도 상담하면서 함께 잡아 드립니다.',
    },
    {
      q: '비용은 어떻게 정해지나요?',
      a: '작업 범위를 먼저 확정한 뒤 고정 금액으로 안내드립니다. 진행 중에 범위가 늘어나면 미리 알려드리고 합의한 뒤에만 추가합니다.',
    },
    {
      q: '직접 운영하는 마크 서버는 언제 열리나요?',
      a: '셋업과 점검이 끝나는 대로 오픈 일정을 마크 서버 페이지와 디스코드 공지에 함께 올립니다.',
    },
    {
      q: '납품 후에도 봐주시나요?',
      a: '네. 버그 수정은 납품 후에도 진행하며, 이후 업데이트와 기능 추가는 유지보수 계약으로 이어 받습니다.',
    },
    {
      q: '구동기를 다운했는데 앱이 차단당했어요',
      a: '코드 서명 인증서가 없는 배포본이라 윈도우 스마트스크린이나 백신이 차단하는 경우가 있습니다. 사이트에서 받는 설치본은 zip 으로 들어 있으니 압축을 푼 뒤 안의 설치 파일을 실행해 주세요 — 압축을 풀고 실행하면 경고가 훨씬 적게 뜹니다. 그래도 막히면 "더 정보" → "그래도 실행"으로 진행하시고, 백신이 막으면 윈도우 보안 → 바이러스 및 위협 방지에서 허용으로 추가해 주세요. 맥은 파일을 우클릭(컨트롤 클릭) 후 "열기"로 실행하시면 됩니다. 받은 파일이 lubit.kr 또는 공식 릴리스의 배포본이 맞는지도 함께 확인해 주세요.',
    },
    {
      q: '문의는 어떻게 하나요?',
      a: '아래 문의 폼에 이메일을 남기시거나, 디스코드 채널로 바로 연락 주셔도 됩니다.',
    },
  ],
}

export const cta = {
  title: '만들고 싶은 걸 말씀해주세요',
  description: '원하는 작업과 예산, 기한을 남겨주시면 범위와 일정을 정리해 24시간 안에 회신드립니다.',
  fields: {
    name: '이름',
    email: '이메일 주소',
    message: '문의 내용 — 원하는 작업, 예산, 기한',
  },
  button: '문의하기',
  success: '문의가 접수되었습니다. 확인 후 빠르게 연락드리겠습니다.',
}

export const footer = {
  blurb: '마크 서버, 마크 클라이언트, 웹사이트 외주까지 한 곳에서.',
  columns: [
    {
      title: '서비스',
      links: [
        { label: '마크 서버', href: '/mc-server' },
        { label: '시스템 외주', href: '/outsourcing' },
        { label: '마크 클라이언트', href: '/client' },
        { label: '서버 구동기', href: '/engine' },
        { label: '디스코드 봇', href: '/bot' },
        { label: '웹사이트 외주', href: '/website' },
      ],
    },
    {
      title: '지원',
      links: [
        { label: '문의하기', href: '/support' },
        { label: '변경점', href: '/changelog' },
        { label: '견적 안내', href: '/#pricing' },
        { label: '진행 방식', href: '/#how' },
        { label: '자주 묻는 질문', href: '/#faq' },
      ],
    },
    {
      title: '정책',
      links: [
        { label: '이용약관', href: '/terms' },
        { label: '개인정보처리방침', href: '/privacy' },
        { label: '환불 정책', href: '/refund' },
      ],
    },
  ],
  legal: `© ${new Date().getFullYear()} lubit. All rights reserved.`,
}

// 연락 채널 설정. 값을 채우면 폼 전송과 채팅이 실제로 동작합니다.
//   email        : 답장을 받을 주소
//   web3formsKey : https://web3forms.com 에서 무료 발급 (제출 건수 상한 있음)
//   chat         : https://www.tawk.to 에서 무료 생성한 propertyId
export const contact = {
  email: '',
  web3formsKey: '',
  chat: { propertyId: '', language: '1e54o14o' },
}

export const support = {
  badge: '지원',
  title: '무엇이든 물어보세요',
  description:
    '서비스 이용, 견적, 진행 일정, 오류 신고까지. 편한 채널로 연락 주시면 24시간 안에 회신드립니다.',
  channels: [
    {
      title: '이메일',
      description: '작업 내용과 예산, 기한을 적어 보내주시면 범위부터 정리해 회신합니다.',
      action: { label: '메일 보내기', kind: 'email' as const },
    },
    {
      title: '실시간 채팅',
      description: '화면 오른쪽 아래 채팅으로 바로 물어보세요. 운영 중일 때는 실시간으로 답합니다.',
      action: { label: '채팅 열기', kind: 'chat' as const },
    },
    {
      title: '디스코드',
      description: '빠른 질문과 공지 확인에 가장 편합니다. 서버 상태와 업데이트 소식도 함께 올라옵니다.',
      action: { label: '채널 열기', kind: 'link' as const, href: '#' },
    },
  ],
  quickLinks: [
    { label: '견적 안내', href: '/#pricing' },
    { label: '진행 방식', href: '/#how' },
    { label: '자주 묻는 질문', href: '/#faq' },
    { label: '전체 서비스', href: '/#services' },
  ],
}

export const legal = {
  terms: {
    title: '이용약관',
    updated: '시행일 2026년 10월 30일',
    intro:
      '이 약관은 lubit(이하 "스튜디오")가 제공하는 웹사이트, 프로그램 제작 및 외주 서비스의 이용 조건과 절차를 정하는 것을 목적으로 합니다.',
    sections: [
      {
        heading: '제1조 (서비스의 제공)',
        paragraphs: [
          '스튜디오는 마크 서버 셋업, 시스템 및 프로그램 외주, 웹사이트 제작, 자체 소프트웨어의 배포와 운영을 제공합니다.',
          '서비스의 내용과 일정은 이용자와 협의하여 확정하며, 확정된 내용은 별도의 견적서 또는 메시지로 안내합니다.',
        ],
      },
      {
        heading: '제2조 (이용자의 의무)',
        paragraphs: [
          '이용자는 신청 시 사실에 맞는 정보를 제공해야 하며, 타인의 권리를 침해하는 자료나 목적을 제출해서는 안 됩니다.',
          '이용자는 관련 법령과 본 약관을 준수해야 하며, 위반 시 스튜디오는 서비스 제공을 중단할 수 있습니다.',
        ],
      },
      {
        heading: '제3조 (계약의 성립과 변경)',
        paragraphs: [
          '외주 계약은 견적 내용과 일정에 대한 양 당사자의 확인으로 성립합니다.',
          '성립 이후 작업 범위를 변경하려면 추가 내용과 비용, 일정을 먼저 합의한 뒤에 진행합니다.',
        ],
      },
      {
        heading: '제4조 (지식재산권)',
        paragraphs: [
          '납품받은 결과물의 귀속은 계약 시 정한 바에 따릅니다. 별도의 정이 없으면 완성된 결과물은 대금 지급 시 이용자에게 귀속됩니다.',
          '스튜디오가 기존에 보유한 공통 코드와 라이브러리는 사용권만 허락하며, 이용자는 이를 재배포할 수 없습니다.',
        ],
      },
      {
        heading: '제5조 (책임의 한계)',
        paragraphs: [
          '스튜디오는 천재지변, 서비스 제공자의 장애, 이용자의 잘못된 설정 등 합리적으로 통제할 수 없는 사유로 발생한 손해에 대해 책임을 지지 않습니다.',
          '소프트웨어는 상태 그대로 제공되며, 특정 목적에의 적합성은 별도의 보증이 없는 한 책임지지 않습니다.',
        ],
      },
      {
        heading: '제6조 (약관의 변경)',
        paragraphs: [
          '스튜디오는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 이 페이지에 공지한 시점부터 효력이 발생합니다.',
        ],
      },
    ],
  },
  privacy: {
    title: '개인정보처리방침',
    updated: '시행일 2026년 10월 30일',
    intro:
      'lubit(이하 "스튜디오")는 이용자의 개인정보를 소중하게 여기며, 관련 법령을 준수하여 개인정보를 처리합니다.',
    sections: [
      {
        heading: '수집하는 개인정보',
        paragraphs: [
          '스튜디오는 문의 접수 시 이름, 이메일 주소, 디스코드 아이디, 그리고 이용자가 직접 입력한 작업 내용을 수집합니다.',
          '결제가 필요한 경우 결제 대행사를 통해 카드 정보가 처리되며, 스튜디오는 카드 번호를 직접 보관하지 않습니다.',
        ],
      },
      {
        heading: '개인정보의 이용 목적',
        paragraphs: [
          '수집한 개인정보는 문의 회신, 견적 안내, 계약 이행, 서비스 공지, 오류 대응에 사용합니다.',
          '동의 없는 다른 목적으로는 사용하지 않으며, 제3자에게 제공하지 않습니다.',
        ],
      },
      {
        heading: '보유 및 이용 기간',
        paragraphs: [
          '문의와 견적 관련 기록은 처리 완료 후 1년간 보관한 뒤 지체 없이 파기합니다.',
          '관계 법령에 따라 보관이 필요한 경우 해당 기간 동안 안전하게 분리 보관합니다.',
        ],
      },
      {
        heading: '개인정보의 파기',
        paragraphs: [
          '보유 기간이 지난 개인정보는 복구할 수 없는 방법으로 영구 삭제합니다. 전자 파일은 복구 불가하게 덮어쓰기합니다.',
        ],
      },
      {
        heading: '이용자의 권리와 행사 방법',
        paragraphs: [
          '이용자는 언제든 자신의 개인정보를 조회, 수정, 삭제를 요청할 수 있습니다.',
          '요청은 문의 폼 또는 디스코드 채널로 접수하면 본인 확인 후 지체 없이 처리합니다.',
        ],
      },
      {
        heading: '쿠키의 운영',
        paragraphs: [
          '스튜디오 사이트는 방문 기록 파악을 위한 최소한의 쿠키를 사용할 수 있으며, 브라우저 설정에서 차단할 수 있습니다.',
        ],
      },
      {
        heading: '개인정보 보호책임자',
        paragraphs: [
          '개인정보 처리에 관한 문의는 아래 채널로 접수해 주세요. 담당자가 확인 후 회신드립니다.',
          '문의 채널: 디스코드 채널 또는 사이트 문의 폼',
        ],
      },
    ],
  },
  refund: {
    title: '환불 정책',
    updated: '시행일 2026년 10월 30일',
    intro: 'lubit(이하 "스튜디오")의 서비스 환불 기준을 안내합니다. 외주 계약과 정기 서비스는 기준이 다르므로 아래를 확인해 주세요.',
    sections: [
      {
        heading: '환불 원칙',
        paragraphs: [
          '서비스 이용 후 24시간 이내이고 사용 이력이 적은 경우 환불을 지원합니다.',
          '환불 신청은 문의 폼 또는 디스코드 채널로 접수해 주세요.',
        ],
      },
      {
        heading: '외주 개발 환불',
        paragraphs: [
          '외주 계약은 착수 단계와 납품 단계로 나눠 정산합니다. 착수 이전까지는 전액, 착수 이후에는 진행된 작업량만큼을 제외한 금액을 환불합니다.',
          '이미 사용된 재료비나 외부 라이선스 비용이 있는 경우 해당 금액은 환불에서 제외됩니다.',
        ],
      },
      {
        heading: '환불이 어려운 경우',
        paragraphs: [
          '요구사항에 맞춰 작업이 완료되었거나, 이용자가 확인 후 납품을 받은 경우.',
          '작업이 상당 부분 진행된 이후 이용자의 단순 변심으로 해지를 요청하는 경우.',
          '타인에게 전달되거나 복제가 불가능한 형태로 제공이 완료된 경우.',
        ],
      },
      {
        heading: '환불 절차',
        paragraphs: [
          '환불 요청을 접수하면 영업일 기준 3일 이내에 처리 여부를 회신드립니다.',
          '승인된 환불은 결제 수단에 따라 3~7일 이내에 반영됩니다.',
        ],
      },
      {
        heading: '문의',
        paragraphs: ['환불과 결제에 관한 문의는 디스코드 채널 또는 사이트 문의 폼으로 연락 주세요.'],
      },
    ],
  },
}

export type LegalDoc = (typeof legal)['terms']
