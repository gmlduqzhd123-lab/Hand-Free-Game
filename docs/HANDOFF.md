# Hand-Free-Game 작업 인계 기록 (HANDOFF)

- **PRD 버전**: v1.1 (`docs/PRD.md`, 2026-10-18 기준)
- **브랜치와 기준 커밋**: `main` (초기 기준 커밋: `dbf33974da5bc441de851fc1d5b81c4d90a06245`, 최신 구현 커밋: `3c52608`)
- **미커밋 변경 및 관련 파일 해시 기록 위치**: `git status` 및 `CHANGELOG.md`
- **현재 단계와 작업 ID**: 0단계~3단계 전체 구현 및 최종 공개 전 통합·성능·오프라인·시각 검수 완료

## FR01~FR10 및 최종 검증 상태
- **0단계 (저장 스키마 v5·마이그레이션·PWA 자산 캐시·테스트 필터 안전장치)**: 검증 완료
- **FR01 (신규 이용자 첫 3분 온보딩 안내 카드)**: 검증 완료
- **FR02 (강화 전후 수치 비교, 묶음 구매 `1`/`10`/`max`, 플레이 성향 추천)**: 검증 완료
- **FR03 (조건부 자동 강화 규칙과 골드 예산·보유 하한 제어)**: 검증 완료
- **FR04 (보스 진입 모드 선택, 준비 대기 상태, 격파 예상·실패 분석 안내)**: 검증 완료
- **FR05 (모험 지역 5곳 해금, 지도·이야기 대화상자)**: 검증 완료
- **FR06 (추가 동료 4명 해금, 2인 동행 슬롯, 시너지 2종, 프리셋 3개)**: 검증 완료
- **FR07 (캐릭터·교실 꾸미기 5슬롯 15항목, 실시간 미리보기, 0 전투 보너스)**: 검증 완료
- **FR08 (업적 진행률 막대, 목표 최대 3개 고정/추천, 미수령 일괄 수령)**: 검증 완료
- **FR09 (복귀 정산 보고서 최대 10건 보관, 1200×1200 PNG 모험 기록 카드 저장)**: 검증 완료
- **FR10 (연수 정산 전후 비교 대화상자, 유지/초기화 목록, 진행 변동 시 재확인)**: 검증 완료
- **최종 검증 (24시간 정산 성능 측정, 256KiB 백업 상한, 첫 오프라인 재실행, 타 앱 캐시 보존, `--screenshots` 39장 시각 검수)**: 검증 완료

## 이번 변경과 충족한 완료 기준
1. **저장 스키마 v5 및 마이그레이션 (`save.js`)**:
   - `VERSION = 5`, 구버전(`v1`~`v4`) 세이브 로드 시 첫 영구 저장 직전에 `TeacherRPG_Save_v4_backup`에 원본 바이트 보존.
   - `preferences`, `onboarding`, `automation`, `bossControl`, `adventure`, `extraCompanions`, `companionLoadout`, `companionPresets`, `cosmetics`, `trackedGoals`, `recentReports`, `pendingAutoReport` 구조 검증 및 정규화.
   - 시계 역행(`now < lastActiveAt`) 시 모든 미래 절대 시각(`skill`, `skillTimers`, `buff`, `mob.deadline`, `automation.lastBuyAt`, `recentReports[*].createdAt`)을 동일한 음수 차이만큼 이동.
2. **모험·동료·꾸미기 정적 데이터 및 전투 연동 (`adventure.js`, `game.js`)**:
   - 5개 모험 장소(`classroom`, `library`, `science`, `gym`, `gate`), 6명 동료(`na`, `yu`, `library`, `science`, `music`, `tidy`), 2종 시너지(`study-care`, `lab-rhythm`), 5슬롯 15개 꾸미기 정의.
   - 보스 준비 대기(`bossPending`) 상태에서 자동·수동 공격, 스킬 발동, 경과 시간 보상이 보스를 타격하지 않도록 격리하고, 보스 시간 만료 시 `lastFailure` 스냅샷 기록.
3. **강화 견적·추천·목표·복귀 보고서·정산 계획 (`progression.js`)**:
   - 부작용 없는 `quotePurchase`, 원자적 후보 적용 `applyPurchaseToCandidate` / `applyPurchase`, 성향별(`idle`/`tap`) `recommendUpgrades`, 구매 상태 시그니처 캐싱(`getPurchaseStateSignature`).
   - `predictBoss`, `analyzeBossFailure`, `getTrackedOrRecommendedGoals`, `toggleTrackedGoal`, `settleAway`(24시간 상한·중복 지급 방지), `buildPrestigePlan`(시그니처 기반 신선도 검사).
4. **자동 강화 엔진 (`automation.js`)**:
   - 전면 활성 탭·열린 대화상자 없음·쓰기 권한·보스 대기 조건·1,000ms 구매 간격·예산 상한(`budgetLimit`)·최소 보유 골드(`reserveGold`) 준수 및 영구 저장 성공 시에만 반영.
5. **UI·반응형 레이아웃·PWA 캐시 (`catalog-ui.js`, `experience-ui.js`, `app.js`, `index.html`, `presentation.css`, `sw.js`, `README.md`)**:
   - 상단 헤더(`#header .header-actions`)와 설정 탭(`#tab-sys`)에 **게임 저장**(`#btn-save-game`, `#btn-sys-save` → `GameApp.saveGame()`) 및 **게임 종료**(`#btn-exit-game`, `#btn-sys-exit` → `GameApp.exitGame()`) 버튼 추가.
   - 24개 해상도(모바일·태블릿·데스크톱)에서 가로 넘침·컨트롤 겹침·잘림 0건, 최소 터치 영역 `44×44px`, `prefers-reduced-motion` 준수.
   - `sw.js` 캐시 버전을 `hand-free-game-v2`로 관리하고 34개 필수 프리캐시 자산 등록, 타 웹앱 캐시(`other-app-cache-v1`) 및 저장 데이터 보존, 네트워크 차단 상태(`offline`)에서 페이지 재실행 검증 완료.

## 변경 파일과 중요한 연결점
- `save.js`: `GameLimits`, `Data.createDefault`, `Data.migrate`, `Data.validateState`, `Data.normalizeState`, `Data.shiftTimestamps`
- `adventure.js`: `Adventure` (장소·동료·시너지·꾸미기·해금 동기화)
- `progression.js`: `Progression` (묶음 구매 견적/적용·추천·보스 예측/분석·목표·복귀 정산·연수 정산 계획)
- `automation.js`: `AutomationEngine` (자동 강화 규칙·예산/보유 하한·영구 저장 보장)
- `game.js`: `Simulation`, `Ach.getProgress`, `Ach.claimAll`, `Logic`, `Combat`
- `catalog-ui.js`: 상점 카드 묶음 구매(`1`/`10`/`max`) 견적 및 부족 골드 표시
- `experience-ui.js`: `ExperienceUI` (온보딩·강화/추천·동료/프리셋·자동 강화·보스 안내·지도·꾸미기·복귀 보고서/기록 카드·연수 정산 대화상자)
- `app.js`, `index.html`, `presentation.css`, `sw.js`, `README.md`, `CHANGELOG.md`: 앱 루프·대화상자·스타일·서비스 워커·문서 통합
- `tests/prd-v5.test.js`, `tests/browser_smoke.py`: PRD v1.1 수용 기준 단위·브라우저·성능·오프라인 테스트

## 검증 명령·결과·환경
- **실행 환경**: Windows, Node.js, Python 3.12.14 + Playwright (Chromium headless)
- **Node 단위·통합·성능 테스트 (7개 스위트, 108개 테스트 전체 통과)**:
  ```bash
  node --test tests/bug-save.test.js tests/character.test.js tests/expansion.test.js tests/game.test.js tests/bug-combat.test.js tests/hold-input.test.js tests/prd-v5.test.js
  ```
  - 24시간(86,400,000ms) 자리비움 정산 성능 측정: 기존 `Simulation.simulate` 대비 2배 이내 기준 충족 (약 550~600ms 내 완료, 기존과 동일한 골드·처치·레벨·경험치 보장)
  - 최대 10건 복귀 보고서 포함 시 직렬화/백업 크기: `256KiB` 상한 이내 확인
- **Playwright 브라우저 스모크 및 시각 검수 테스트 (44개 체크 전체 통과 + 39장 스크린샷 캡처 + 0건 필터 실패 확인)**:
  ```bash
  python tests/browser_smoke.py http://127.0.0.1:8000/index.html --screenshots <dir> --output <json>
  ```
  - `--check nonexistent_filter_xyz` 실행 시 종료 코드 `1` 반환 확인
  - 서비스 워커 34개 필수 자산 프리캐시, 타 웹앱 캐시(`other-app-cache-v1`) 및 `TeacherRPG_Save_v4_backup` 보존, `context.set_offline(True)` 상태에서 `page.reload()` 후 정상 부팅·플레이 확인

## 남은 문제와 다음 작업
- **남은 문제**: 없음
- **다음 작업**: 완료 (모든 코드·문서·검증 결과가 `origin/main`에 반영됨)
