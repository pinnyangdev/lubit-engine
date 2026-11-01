import { useEffect } from 'react'

import { ChatWidget } from './components/ChatWidget'
import { ChangelogPage } from './pages/ChangelogPage'
import { ConsolePage } from './pages/ConsolePage'
import { legal, services, type LegalDoc } from './content'
import { initSpotlight } from './lib/spotlight'
import { InboxPage } from './pages/InboxPage'
import { AdminPage } from './pages/AdminPage'
import { JoinGuidePage } from './pages/JoinGuidePage'
import { LegalPage } from './pages/LegalPage'
import { ServicePage } from './pages/ServicePage'
import { SupportPage } from './pages/SupportPage'
import { Faq } from './sections/Faq'
import { Features } from './sections/Features'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { LogoCloud } from './sections/LogoCloud'
import { Metrics } from './sections/Metrics'
import { Nav } from './sections/Nav'
import { Pricing } from './sections/Pricing'
import { ServerStatus } from './sections/ServerStatus'
import { Services } from './sections/Services'
import { Steps } from './sections/Steps'
import { Testimonials } from './sections/Testimonials'

const defaultTitle = 'Lubit - 루빗 스튜디오'
const defaultDescription =
  '시스템 외주와 웹사이트 외주, 마크 클라이언트, 서버 구동기, 디스코드 봇까지 한 팀이 기획부터 제작·유지보수까지 맡습니다.'

const legalDocs: Record<string, LegalDoc> = {
  '/terms': legal.terms,
  '/privacy': legal.privacy,
  '/refund': legal.refund,
}

function normalizePath() {
  const path = window.location.pathname.replace(/\/+$/, '')
  return path === '' ? '/' : path
}

function setDescription(content: string) {
  document.querySelector('meta[name="description"]')?.setAttribute('content', content)
}

function Home() {
  return (
    <>
      <Hero />
      <LogoCloud />
      <Services />
      <Features />
      <Steps />
      <ServerStatus />
      <Metrics />
      <Testimonials />
      <Pricing />
      <Faq />
    </>
  )
}

export function App() {
  const path = normalizePath()
  const service = services.find((item) => `/${item.slug}` === path)
  const doc = legalDocs[path]
  const isSupport = path === '/support'
  const isInbox = path === '/support/inbox'
  const isAdmin = path === '/admin'
  const isJoinGuide = path === '/mc-server/join'
  const isConsole = path === '/console'
  const isChangelog = path === '/changelog'

  useEffect(() => {
    // 카드 스포트라이트: 전역 리스너 한 번만 붙입니다.
    return initSpotlight()
  }, [])

  useEffect(() => {
    if (service) {
      document.title = `${service.name} | lubit`
      setDescription(service.description)
    } else if (doc) {
      document.title = `${doc.title} | lubit`
      setDescription(doc.intro)
    } else if (isSupport) {
      document.title = '지원 | lubit'
      setDescription(defaultDescription)
    } else if (isInbox) {
      document.title = '채팅 수신함 | lubit'
      setDescription(defaultDescription)
    } else if (isJoinGuide) {
      document.title = '서버 접속 방법 | lubit'
      setDescription('마크 서버에 접속하는 네 단계 방법과 접속이 안 될 때의 해결책을 안내합니다.')
    } else if (isConsole) {
      document.title = '서버 콘솔 | lubit'
      setDescription('등록한 마크 서버를 웹에서 시작·중지하고 콘솔 로그를 확인합니다.')
    } else if (isChangelog) {
      document.title = '변경점 | lubit'
      setDescription('루빗 서버 구동기와 사이트의 버전별 변경 사항을 정리합니다.')
    } else {
      document.title = defaultTitle
      setDescription(defaultDescription)
    }
  }, [service, doc, isSupport, isInbox, isJoinGuide, isConsole, isChangelog])

  let page = <Home />
  if (isInbox) page = <InboxPage />
  else if (isAdmin) page = <AdminPage />
  else if (isConsole) page = <ConsolePage />
  else if (isChangelog) page = <ChangelogPage />
  else if (isJoinGuide) page = <JoinGuidePage />
  else if (service) page = <ServicePage service={service} />
  else if (isSupport) page = <SupportPage />
  else if (doc) page = <LegalPage doc={doc} />

  return (
    <>
      <Nav />
      <main>{page}</main>
      <Footer />
      <ChatWidget />
    </>
  )
}
