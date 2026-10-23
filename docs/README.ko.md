# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [עברית](README.he.md) | [日本語](README.ja.md) | 한국어 | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (Brasil)](README.pt-BR.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [繁體中文](README.zh-TW.md)

**OpenChamber용 읽기 전용 Argo CD 확장 기능**입니다. 작업 공간을 벗어나지 않고 애플리케이션과 배포를 살펴보고 리소스 로그 및 이벤트를 읽을 수 있습니다.

## 설치

1. OpenChamber에서 **설정 → 확장 기능**을 엽니다.
2. **폴더, ZIP 또는 URL**에 다음 저장소 URL을 붙여 넣고 **추가**를 클릭합니다.

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. 요청된 Service 기능을 검토하고 **허용 및 활성화**를 선택합니다.
4. 확장 기능 바에서 **Argo CD**를 열고 기존 컨텍스트를 불러옵니다.

로컬 빌드나 의존성 설치는 필요하지 않습니다.

또는 [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest)에서 **openchamber-argocd.zip**을 다운로드하여 확장 기능에 추가하세요. GitHub의 **Source code (zip)**이 아닌 첨부된 사전 빌드 ZIP을 사용하세요.

## 사전 요구 사항

- **확장 기능을 지원하는 OpenChamber**. 확장 기능은 [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0)에서 도입되었습니다. 현재 이 빌드의 설치 최소 버전은 **v2.2.0**이며, 이전 버전과의 호환성은 검증되지 않았습니다.
- OpenChamber Server를 실행하는 운영 체제 사용자에게 **Argo CD CLI가 설치 및 설정되어 있어야 합니다**. 유효한 인증 정보와 필요한 애플리케이션, 리소스, 로그 및 이벤트에 대한 읽기 권한이 필요합니다. 확장 기능은 기존 설정을 읽으며, CLI를 실행하거나 별도로 로그인하지 않습니다.
- OpenChamber Server에서 설정된 Argo CD API에 접근할 수 있어야 합니다.

## 스크린샷

예제 데이터를 사용한 영어 인터페이스입니다.

**데스크톱 — 애플리케이션 목록 및 개요**

![데스크톱의 Argo CD 애플리케이션 목록 및 개요](applications-desktop.png)

**모바일 — 애플리케이션 목록**

![모바일의 Argo CD 애플리케이션 목록](applications-mobile.png)

## 기능

- Argo CD 컨텍스트 전환 및 애플리케이션 검색과 필터링.
- 애플리케이션 설정, 상태, 배포 이력 및 리소스 트리 확인.
- Pod/컨테이너 로그, 이벤트, 매니페스트 및 차이점 읽기.
- 문제 해결 요약을 미리 보고 확인한 후 채팅에 추가.
- 설계상 읽기 전용이며 OpenChamber의 언어와 테마를 따름.

## 개인정보 보호

- 이 확장 기능은 개인정보를 수집하거나 비공개 데이터를 개발자에게 전송하지 않습니다. 원격 측정, 분석 또는 추적 기능이 없습니다.
- 기존 로컬 인증 정보는 설정된 Argo CD API 요청을 인증하기 위해서만 읽습니다. 인증 정보, 애플리케이션 데이터, 로그 및 이벤트는 개발자나 제3자가 운영하는 데이터 수집 서비스에 업로드되지 않습니다.
- 탐색 환경설정(디렉터리, 컨텍스트, 애플리케이션/리소스 식별자, 필터, 탭 및 레이아웃)은 OpenChamber 저장소에 저장됩니다. 지원되는 경우 현재 기기에, 그렇지 않으면 연결된 Server에 저장됩니다. 인증 정보, 쿼리 결과, 로그/이벤트 본문 및 요약 미리보기는 여기에 저장되지 않습니다. 선택 항목을 복원하면 데이터를 다시 조회하며, 로그 추적은 자동으로 재개되지 않습니다.
- 요약을 채팅에 추가하려면 사용자의 명시적인 미리보기와 확인이 필요합니다. 이후 전송하면 OpenChamber와 선택한 모델 제공업체가 각자의 정책에 따라 내용을 처리합니다.

이 설명은 이 확장 기능에만 적용되며 OpenChamber, Argo CD 또는 모델 제공업체의 데이터 처리 방침을 다루지 않습니다.

## 라이선스

[MIT](../LICENSE). 포함된 의존성과 Argo 아이콘에는 각각의 라이선스가 유지됩니다. [제3자 고지](../THIRD_PARTY_NOTICES.txt)를 참고하세요.
