루빗 중계 서버 설치 (Windows VPS)
==================================

이 폴더를 VPS로 옮겨 압축을 푼 뒤, 관리자 PowerShell에서 한 번만 실행하면 됩니다.

    powershell -ExecutionPolicy Bypass -File .\install.ps1


무엇을 하나요
  1. Node.js 가 없으면 LTS 를 내려받아 C:\LubitRelay\node 에 설치합니다.
  2. 중계 서버 파일을 C:\LubitRelay 로 복사합니다.
  3. 방화벽을 엽니다.
       TCP 7777        에이전트(집 PC)가 밖으로 연결
       TCP 25565-25664 플레이어가 접속 (서버 1대당 포트 1개, 최대 100대)
  4. 예약 작업 "LubitRelay" 를 등록하고 지금 바로 시작합니다. 재부팅해도 자동으로 켜집니다.


확인하는 방법
  Get-NetTCPConnection -LocalPort 7777 -State Listen
  Get-ScheduledTask -TaskName LubitRelay | Get-ScheduledTaskInfo

  실행 중 로그를 보려면
  schtasks /Run /TN LubitRelay
  (C:\LubitRelay 에서 C:\LubitRelay\node\node.exe relay\server.js 를 직접
   돌려보면 콘솔에 그대로 찍힙니다)


lubit.kr 쪽 설정 (워커 시크릿)
  RELAY_IP   = 112.168.140.252   (플레이어가 접속하는 주소)
  RELAY_HOST = 112.168.140.252   (에이전트가 연결하는 주소)
  RELAY_CONTROL_PORT = 7777      (생략하면 7777)


지우는 방법
  Unregister-ScheduledTask -TaskName LubitRelay -Confirm:$false
  Remove-NetFirewallRule -DisplayName 'Lubit Relay (에이전트)'
  Remove-NetFirewallRule -DisplayName 'Lubit Relay (플레이어)'
  Remove-Item -Recurse -Force C:\LubitRelay


보안 메모
  - 이 서비스는 마인크래프트 평문 TCP 를 그대로 옮깁니다. TLS 는 쓰지 않습니다.
  - 7777 을 임의 포트로 바꾸려면 start.cmd 와 방화벽 규칙, RELAY_CONTROL_PORT 를
    함께 바꿔야 합니다.
  - 계정 비밀번호를 채팅이나 파일에 남기지 말고, VPS 안에서만 쓰세요.
