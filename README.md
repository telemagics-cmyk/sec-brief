# 일일 보안 브리핑 (sec-brief v2)

평일 아침 **이슈가 된 보안 뉴스와 주요 취약점**을 모아 **카카오톡(나에게 보내기)** 과 (선택) **메일**로 받고,
지난 브리핑을 **웹 이력**(날짜별 페이지·취약점 색인·검색)으로 남깁니다.

평일 06:00(KST)에 무료 예약 서비스(cron-job.org)가 GitHub Actions 를 시작시키고 06:30 에 보냅니다
(06:15 재호출, GitHub 자체 예약 05:05·06:35 는 예비). **주말과 공휴일에는 만들지도 보내지도 않고**, 다음 평일 브리핑이
쉰 기간의 소식을 모두 담습니다. PC 를 켜 둘 필요가 없고, 공개 저장소라면 비용이 들지 않습니다(Claude 요약을 켜면 API 사용료만 듭니다).

```
평일 06:00 KST 시작 (06:15 재호출) ─ cron-job.org 가 부르는 GitHub Actions (GitHub 예약은 예비)
  ├─ 주말·공휴일(공식 월력요항 기준)이면 여기서 끝
  ├─ 기간: 평소 30시간, 쉬고 온 날은 지난 브리핑 이후 전부(최대 10일)
  ├─ 수집: CISA KEV · NVD · FIRST EPSS · KISA 보호나라(보안공지·취약점·경보단계)
  │        국내외 보안 매체 RSS · Google 뉴스(국내) · (선택) 네이버 뉴스 검색
  ├─ 선별: 여러 매체가 함께 다룬 사건을 묶어 '이슈' 판단, 홍보·행사 기사 제외
  │        취약점은 실제 악용(KEV) 우선, 고위험은 같은 공지끼리 묶고 관심 제품·KISA 권고·보도 여부로 순위
  ├─ (선택) Claude: 기사 고르기·한국어 요약 — 사실(CVE·점수·링크)은 원본 그대로
  ├─ 이력 저장: data/briefs/YYYY/YYYY-MM-DD.json·.md → 저장소에 커밋
  ├─ 웹 이력 게시: GitHub Pages (https://<아이디>.github.io/<저장소>/)
  └─ 06:30 발송
       ├─ 카카오톡: 주요 3건 카드 + [오늘 브리핑 전체] [지난 브리핑] 버튼
       └─ (선택) 메일: 브리핑 전문(웹 페이지와 같은 순서)
```

## 무엇이 나아졌나 (이전 도구 대비)

| | 이전 (루틴·아티팩트 / sec-brief-local) | 지금 |
|---|---|---|
| 실행 | 클라우드 에이전트가 매번 작성하거나, 내 PC 가 켜져 있어야 함 | GitHub Actions 가 같은 코드로 평일마다 실행, 실패하면 GitHub 가 메일로 알림 |
| 카카오 토큰 | 액세스 토큰(수 시간 유효)을 직접 넣어 하루 뒤 401 | 리프레시 토큰으로 매일 갱신, 갱신된 토큰은 암호화해 보관 → 다시 로그인할 일 없음 |
| 카카오 메시지 | 텍스트 템플릿에 긴 본문 (공식 한도 200자 초과) | 리스트형 카드 3건 + 버튼 2개 (또는 200자 이내 텍스트형) |
| 웹 이력 | claude.ai 아티팩트(로그인 필요) 또는 내 PC 의 파일 | 휴대폰에서 바로 열리는 날짜별 주소, 지난 목록·취약점 색인·전체 검색·RSS |
| 취약점 | NVD CVSS 9.5 이상만 → 실제 악용(KEV) 누락, 같은 공지의 CVE 가 상위를 독차지 | KEV 신규 등재를 먼저, 고위험은 공지 단위로 묶어 순위 |
| 국내 공지 | 없음 | KISA 보안공지·취약점 정보·**사이버위기 경보단계**(바뀌면 맨 앞에 강조) |
| 뉴스 | 검색어 결과(키 필요, 홍보 기사 섞임) | 보안 매체·Google 뉴스 RSS(키 불필요), 보도 매체 수로 이슈 판단 |
| 실패 표시 | 조용히 비어 있음 | 출처별 수집 상태를 브리핑에 기록, '없음'과 '수집 실패'를 구분 |

## 처음 설정 (약 20분)

### 1. GitHub 저장소에 올리기

1. GitHub 에서 새 저장소를 만듭니다 (예: `sec-brief`). **Public** 이면 Actions·Pages 가 무료입니다.
   비공개 저장소에서 Pages 를 쓰려면 GitHub Pro 이상이 필요하고, 그 경우에도 웹 이력 주소 자체는 공개 주소입니다.
2. 이 폴더를 올립니다.

   ```powershell
   cd C:\Users\user\sec-brief
   git add -A
   git commit -m "보안 브리핑 v2"
   git remote add origin https://github.com/<아이디>/sec-brief.git
   git push -u origin main
   ```

3. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.

### 2. 카카오 개발자 앱 만들기

[카카오 디벨로퍼스](https://developers.kakao.com)에 로그인해 앱을 하나 만든 뒤:

1. **[카카오 로그인] > [사용 설정]** — 상태를 **ON**
2. **[카카오 로그인] > [동의항목] > [접근권한]** — **카카오톡 메시지 전송** 을 설정 (선택 동의, 목적: 보안 브리핑 수신)
3. **[앱] > [플랫폼 키] > [REST API 키]**
   - **카카오 로그인 리다이렉트 URI** 에 `http://localhost:8765/oauth` 추가
   - **REST API 키** 와 **클라이언트 시크릿**(기본으로 켜져 있음) 값을 복사해 둡니다
4. **[앱] > [제품 링크 관리] > [웹 도메인]** — `https://<아이디>.github.io` 등록
   (카카오 메시지의 버튼·카드가 이 주소로 열립니다. 등록하지 않으면 버튼이 나타나지 않습니다)

### 3. 리프레시 토큰 받기 (이 PC 에서 한 번)

```powershell
cd C:\Users\user\sec-brief
node src/cli.mjs kakao-login
```

REST API 키와 클라이언트 시크릿을 물으면 붙여 넣습니다. 브라우저에서 카카오 로그인과 동의를 마치면
카카오톡 **나와의 채팅**에 확인 메시지가 오고, 터미널에 등록할 값이 나옵니다.
리프레시 토큰은 비밀번호처럼 다루세요(채팅·메신저에 붙여 넣지 마세요).

> 로그인 직후 사용자 정보 조회를 한 번 하도록 해 두었습니다. 카카오는 로그인 후 24시간 안에
> 사용자 정보 API 를 부르지 않은 연결을 '가입 미완료'로 보고 끊습니다.

### 4. GitHub Secrets 등록

저장소 **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 | 필수 |
|---|---|---|
| `KAKAO_REST_API_KEY` | REST API 키 | 카카오톡에 필요 |
| `KAKAO_CLIENT_SECRET` | 클라이언트 시크릿 (사용 안 하면 생략) | 카카오톡에 필요 |
| `KAKAO_REFRESH_TOKEN` | 3단계에서 받은 리프레시 토큰 | 카카오톡에 필요 |
| `OUTLOOK_CLIENT_ID`, `OUTLOOK_REFRESH_TOKEN`, `MAIL_TO` | 아래 [메일로도 받기](#메일로도-받기-선택) — Outlook.com 계정 | 선택: 메일 |
| `MAIL_TITLE` | 메일 제목·본문의 이름 (예: `OO팀 일일 보안 브리핑`). 비우면 `site.title` | 선택: 메일 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO` (`MAIL_FROM`) | 아래 [메일로도 받기](#메일로도-받기-선택) — Gmail 등 | 선택: 메일 |
| `ANTHROPIC_API_KEY` | Claude API 키 | 선택: 한국어 요약·선별 |
| `NVD_API_KEY` | [NVD API 키](https://nvd.nist.gov/developers/request-an-api-key) (무료) | 선택: NVD 요청 한도 완화 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 검색 API | 선택: 국내 기사 보강 |

### 5. 첫 실행

**Actions → daily-brief → Run workflow** (카카오톡·메일 발송: 보내기). 3~5분 뒤 카카오톡이 오고,
`https://<아이디>.github.io/sec-brief/` 에서 웹 이력을 볼 수 있습니다. 이후에는 평일마다 자동입니다(주말·공휴일은 쉼).
연결만 확인하려면 **연결 확인 메시지만** 을 고르세요(카카오톡·메일 모두 짧은 확인 메시지만 갑니다).
손으로 실행하면 06:30 을 기다리지 않고 바로 보냅니다.

### 6. 정시에 받기 — 외부 예약 호출 (권장, 약 10분)

GitHub 자체 예약(cron)은 붐비면 시작이 늦어집니다. 실측으로는 매일 2~3.5시간 늦었습니다
(2026-10-25~28: 05:05 예약이 07:16~08:35 에 시작). 그래서 무료 예약 서비스 [cron-job.org](https://cron-job.org) 가
매일 06:00·06:15 에 GitHub 에 '실행' 요청을 보내게 합니다. 요청으로 시작한 실행은 늦지 않고 바로 시작하며,
수집·게시를 마친 뒤 06:30 에 보냅니다. 06:15 호출은 06:00 실행이 실패했을 때의 재시도이고, 이미 끝났으면 건너뜁니다.
GitHub 자체 예약(05:05·06:35)은 그대로 두어 외부 호출이 오지 않은 날의 예비로 씁니다(같은 날 두 번 보내지 않음).
cron-job.org 는 매일 부르게 두어도 됩니다 — 주말·공휴일이면 워크플로의 첫 작업이 바로 끝냅니다([쉬는 날](#쉬는-날-주말공휴일)).

1. **실행 전용 토큰 만들기** — GitHub 오른쪽 위 프로필 사진 → **Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token**
   - Token name: `sec-brief cron-job.org`
   - Expiration: 1년 (만료일을 달력에 적어 두세요)
   - Repository access: **Only select repositories** → `sec-brief` 하나만
   - Permissions: **Actions → Read and write** 하나만 (Metadata 읽기는 자동으로 붙음)
   - **Generate token** → `github_pat_…` 값을 복사 (화면을 벗어나면 다시 볼 수 없음)

   이 토큰으로는 이 저장소의 워크플로를 실행·취소하는 것만 할 수 있고, 코드·Secrets 는 읽거나 바꿀 수 없습니다.

2. **cron-job.org 작업 만들기** — [console.cron-job.org](https://console.cron-job.org) 에 가입(무료)·로그인 → **CREATE CRONJOB**
   - Title: `sec-brief`
   - URL: `https://api.github.com/repos/<아이디>/sec-brief/actions/workflows/daily-brief.yml/dispatches`
   - 실행 일정: 매일 **06:00·06:15** — 사용자 지정(Custom)에서 시(Hours) `6`, 분(Minutes) `0`·`15`
     (식으로 넣는 칸이면 `0,15 6 * * *`). 06:00 한 번만 해도 됩니다(06:15 재시도가 빠질 뿐).
   - 시간대(Time zone): **Asia/Seoul** — 기본값이 UTC 일 수 있으니 꼭 확인
   - 알림: 실행이 실패하면 메일 받기를 켭니다
   - 고급(ADVANCED) 탭
     - Request method: **POST**
     - Headers — 아래 4개 (Key / Value)

       | Key | Value |
       |---|---|
       | `Authorization` | `Bearer github_pat_…` (1에서 복사한 토큰, 앞에 `Bearer` 와 띄어쓰기 한 칸) |
       | `Accept` | `application/vnd.github+json` |
       | `X-GitHub-Api-Version` | `2026-03-10` |
       | `Content-Type` | `application/json` |

     - Request body: `{"ref":"main","inputs":{"scheduled":"true"}}`
   - **TEST RUN** → 응답이 `200` 이면 성공(본문에 실행 주소가 옵니다) → 저장(CREATE / SAVE)

3. **확인** — 저장소 **Actions** 에 **정시 실행 (외부 호출)** 이 생깁니다. 06:30 전이면 발송 단계가 06:30 까지 기다리고,
   오늘 것을 이미 보냈다면 수집·발송을 건너뜁니다. 실행 목록 이름으로 어느 쪽이 돌았는지 구분합니다:
   **정시 실행 (외부 호출)** / **GitHub 예약 실행 (예비)** / **직접 실행**.
   예비가 발송까지 한 날은 그 실행에 '늦은 발송' 경고가 붙습니다 — cron-job.org 실행 기록(History)을 보세요.

밤 00:00~04:40 에 TEST RUN 을 누르면 그 실행은 브리핑만 만들고 보내지는 않습니다(06:30 까지 너무 길어서). 그날 06:00 호출이 보냅니다.
토큰이 만료되면 cron-job.org 기록에 `401` 이 찍히고 그날부터는 GitHub 예비가 늦게 보냅니다.
같은 설정으로 새 토큰을 받아(GitHub 의 그 토큰 화면에서 **Regenerate token**, 없으면 1을 다시) cron-job.org 의 `Authorization` 값을 바꾸세요.

### 메일로도 받기 (선택)

설정하면 카카오톡과 함께 브리핑 전문을 메일로도 보냅니다(설정하지 않으면 메일은 건너뜀). 보내는 계정은 둘 중 하나입니다.

| 보내는 계정 | 보내는 방식 | 준비 |
|---|---|---|
| **Outlook.com** (@outlook.kr·@outlook.com·@hotmail.com) | Microsoft Graph 메일 API | Microsoft 앱 등록 + 이 PC 에서 로그인 한 번 |
| Gmail | SMTP | 2단계 인증 + 앱 비밀번호 |

Outlook.com 은 비밀번호 방식 SMTP 를 막았고(OAuth 만 허용), 새 계정은 SMTP 자체가 꺼진 경우가 많아 메일 API 로 보냅니다.
둘 다 설정하면 Outlook 으로 보냅니다. 네이버 메일은 해외(GitHub 서버) 접속을 기본으로 막아 권하지 않습니다.

#### Outlook.com 계정으로 보내기

1. **앱 등록** — https://entra.microsoft.com 에 보낼 Outlook 계정으로 로그인 → **앱 등록 → 새 등록**
   - 이름: `sec-brief`
   - 지원되는 계정 유형: **개인 Microsoft 계정만**
   - 리디렉션 URI: 플랫폼 **퍼블릭 클라이언트/네이티브(모바일 및 데스크톱)**, 주소 `http://localhost`
   - **등록** 후 **개요** 화면의 **애플리케이션(클라이언트) ID** 를 복사해 둡니다(비밀값 아님).

   > 개인 계정은 디렉터리가 없어 앱 등록 화면이 열리지 않거나 `AADSTS50020`('Microsoft Services' 테넌트) 오류가 날 수 있습니다.
   > 그때는 같은 계정으로 [Azure 무료 계정](https://azure.microsoft.com/free/)에 가입하면 디렉터리가 만들어집니다
   > (본인 확인으로 휴대폰·카드 정보를 묻지만 앱 등록에는 요금이 없습니다). 이 단계가 막히면 아래 Gmail 방법을 쓰세요.
2. **API 사용 권한 → 권한 추가 → Microsoft Graph → 위임된 권한** 에서 `Mail.Send` 를 추가합니다(`User.Read` 는 처음부터 있음).
   받은 메일을 읽는 권한은 필요 없습니다.
3. **이 PC 에서 로그인 (한 번)**

   ```powershell
   cd C:\Users\user\sec-brief
   node src/cli.mjs mail-login
   ```

   애플리케이션 ID 를 붙여 넣으면 브라우저가 열립니다. 보낼 Outlook 계정으로 로그인하고 권한에 동의하면
   그 계정으로 확인 메일이 오고, 리프레시 토큰이 클립보드에 복사됩니다.
4. 저장소 Secrets 에 넣습니다.

   | 이름 | 값 |
   |---|---|
   | `OUTLOOK_CLIENT_ID` | 1의 애플리케이션(클라이언트) ID |
   | `OUTLOOK_REFRESH_TOKEN` | 3에서 클립보드에 복사된 값(그대로 붙여 넣기) |
   | `MAIL_TO` | (선택) 받을 주소. 여러 개면 쉼표로 구분(서로 주소가 보이지 않게 숨은 참조). 비우면 보내는 계정 자신에게 |

5. **Run workflow → 연결 확인 메시지만** 으로 확인 메일이 오는지 봅니다(정크 메일함도 확인).

리프레시 토큰은 매일 실행 때 새 값으로 바뀌고, 새 값은 `data/mail-state.json` 에 암호화해 저장합니다
(키는 `OUTLOOK_REFRESH_TOKEN` 에서 유도 — 카카오와 같은 방식, 저장소만으로는 풀 수 없음). 다음 경우에는 `mail-login` 을 다시 하고
`OUTLOOK_REFRESH_TOKEN` 을 바꾸세요: 실행이 두세 달 멈췄을 때, 계정 비밀번호를 바꿨을 때,
[계정의 앱 권한](https://account.live.com/consent/Manage)에서 sec-brief 를 지웠을 때(오류에 `invalid_grant` 가 보입니다).
새로 만든 Outlook 계정은 처음 보낼 때 outlook.com 에서 휴대폰 확인을 요구할 수 있습니다(`ErrorMessageSubmissionBlocked`).
GitHub(해외 서버)에서 처음 보낼 때 Microsoft 가 스팸 의심으로 계정을 묶기도 합니다(2026-10-28 실제로 `ErrorAccountSuspend` →
다음 실행은 `service abuse mode`). 그때는 account.microsoft.com 에 로그인해 안내대로(휴대폰 보안 코드 등) 계정을 풀고
(그 선택지가 없으면 화면의 aka.ms/ 링크로 복구 요청 — Microsoft [잠긴 계정 안내](https://support.microsoft.com/help/13956)),
`mail-login` 을 다시 해 `OUTLOOK_REFRESH_TOKEN` 을 바꾼 뒤
**연결 확인 메시지만** 으로 확인합니다. 풀고 나서도 다시 묶이면 Gmail 로 바꾸세요(Outlook Secrets 를 지우면 SMTP 로 보냄).

#### 메일 이름 바꾸기 (선택)

메일 제목 `[일일 보안 브리핑] 10.28(수) | …` 과 본문 맨 위의 이름은 `config.json` 의 `site.title` 을 씁니다.
메일에만 다른 이름(예: 팀·기관 이름을 붙인 `OO팀 일일 보안 브리핑`)을 쓰려면 Secret `MAIL_TITLE` 에 넣습니다.
Secret 이라 공개 저장소·웹 페이지·카카오톡에는 나타나지 않습니다.

#### Gmail 로 보내기

1. 보낼 Gmail 계정에서 **2단계 인증**을 켭니다: https://myaccount.google.com/security → '2단계 인증'
2. **앱 비밀번호**를 만듭니다: https://myaccount.google.com/apppasswords → 앱 이름 `sec-brief` →
   16자리 값이 한 번만 보입니다(띄어 쓴 채 붙여 넣어도 됩니다). 다른 곳에 적어 두지 마세요.
3. 저장소 Secrets 에 넣습니다.

   | 이름 | 값 |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `465` (SSL. 587 이면 STARTTLS 로 연결) |
   | `SMTP_USER` | 보내는 Gmail 주소 |
   | `SMTP_PASS` | 2에서 만든 앱 비밀번호 (Google 계정 비밀번호가 아님) |
   | `MAIL_TO` | 받을 주소. 여러 개면 쉼표로 구분(서로 주소가 보이지 않게 숨은 참조로 보냄) |
   | `MAIL_FROM` | (선택) 보내는 사람 표시. 비우면 `SMTP_USER`. 예: `보안 브리핑 <me@gmail.com>` |

4. **Run workflow → 연결 확인 메시지만** 으로 확인 메일이 오는지 봅니다. 처음 며칠은 받은 편지함이 아니라
   **스팸(정크) 메일함**에 들어갈 수 있으니 '스팸 아님'으로 표시해 두세요.

받는 주소는 Secrets 에만 있고 저장소·웹 페이지에는 남지 않습니다(발송 기록 `data/mail-state.json` 에는 날짜와 받는 사람 수만).
앱 비밀번호는 언제든 2의 화면에서 지워 무효로 만들 수 있습니다.

## 받는 것

**카카오톡** (리스트형) — 머리글 `10.23(금) 보안 브리핑 | 악용 6·고위험 69·뉴스 10` 아래 세 장의 카드:
경보 단계 변경(있을 때) → 국내 1위 이슈 → 해외 1위 이슈 → 실제 악용 취약점(없으면 고위험) 순으로 앞의 세 개.
카카오 리스트형은 카드가 3장까지라 경보가 있는 날은 취약점 카드가 빠집니다(머리글 숫자와 웹 페이지에는 그대로 나옴).
카드를 누르면 웹 이력의 해당 항목으로, 버튼은 그날 브리핑 전체와 지난 브리핑 목록으로 갑니다.

**메일** (설정했을 때) — 제목 `[일일 보안 브리핑] 10.23(금) | 국내 5·해외 5·KISA 3·악용 6·고위험 69`
(경보 단계가 바뀐 날은 맨 앞에 `[경보]`). 본문은 웹 페이지와 같은 순서의 전문이고, 위쪽 건수 칸을 누르면 웹 페이지의 해당 섹션으로 갑니다.

**웹 이력**
- 날짜별 브리핑: 위쪽 건수 요약, 오늘의 요약, 국내 보안 뉴스 → 해외 보안 뉴스(함께 보도한 매체 목록) → KISA 공지 →
  악용 확인 취약점(CISA KEV 신규) → 신규 고위험 취약점(대상·영향·조치), 수집 상태
- 지난 브리핑: 월별 목록 / 취약점 색인: 지금까지 실린 CVE 전체(처음 실린 날) / 검색 / RSS(`feed.xml`)
- 휴대폰·PC, 밝은·어두운 화면 모두 대응. 검색 엔진에는 노출하지 않도록(noindex) 했습니다.

**저장소 이력** — `data/briefs/YYYY/YYYY-MM-DD.json`(원자료)과 `.md`(사람이 읽는 전문). GitHub 화면에서도 읽힙니다.

## 설정 바꾸기 (`config.json`)

| 항목 | 뜻 | 기본값 |
|---|---|---|
| `site.title` | 웹·메시지 제목 (공개 저장소이니 기관명은 신중히) | 일일 보안 브리핑 |
| `window_hours` | 기사 수집 범위 (실행 시각 기준) | 30 |
| `vulns.cvss_min` | 고위험 기준 점수 | 9.0 |
| `vulns.kev_days` | KEV 신규 등재를 며칠 전까지 볼지 (주말 대비) | 3 |
| `vulns.critical_limit` | 본문에 싣는 고위험 묶음 수 (나머지는 목록) | 5 |
| `vulns.watch` | 관심 제품·벤더 — **기관에서 쓰는 제품을 넣으면** 순위가 올라갑니다 | 주요 벤더 60여 개 |
| `news.domestic_limit` / `international_limit` | 국내·해외 기사 수 | 5 / 5 |
| `news.feeds` | 뉴스 출처. `enabled: false` 로 끄고, 같은 형식으로 추가 | 11곳 |
| `summarizer.engine` | `auto`(키가 있으면 Claude) / `claude` / `rules` | auto |
| `summarizer.model` | Claude 모델 (`claude-haiku-5-5` 월 약 0.1~0.2달러 / `claude-opus-5-5` 월 약 3~6달러) | claude-haiku-5-5 |
| `kakao.template` | `list`(카드 3건) / `text`(200자 글) | list |
| `delivery.not_before` | 정시·예약 실행이 이 시각(KST) 전에 끝나면 기다렸다 보냄. `""` 이면 끝나는 대로 | 06:30 |
| `schedule.workdays_only` | 정시·예약 실행은 주말·공휴일에 쉼. `false` 면 매일 | true |
| `schedule.extra_holidays` | 새로 정해진 임시공휴일 등 `{"YYYY-MM-DD": "이름"}` ([쉬는 날](#쉬는-날-주말공휴일)) | `{}` |

**실행 시각**은 cron-job.org 작업의 일정([6. 정시에 받기](#6-정시에-받기--외부-예약-호출-권장-약-10분))과
`.github/workflows/daily-brief.yml` 의 `cron`(UTC 기준, 예비)에서 바꿉니다.
GitHub 예약 실행은 붐비면 시작이 몇 분~몇 시간 늦어지고 드물게 빠지기도 해서(2026-10-25~28 실측 매일 2~3.5시간), 정시 실행은 외부 호출에 맡깁니다.

| 실행 (KST) | 하는 일 |
|---|---|
| 06:00 cron-job.org 호출 | 수집·이력 저장·웹 게시를 먼저 끝내고 `delivery.not_before`(06:30)까지 기다렸다 발송 |
| 06:15 cron-job.org 호출 | 재시도. 앞 실행이 이미 만들고 보냈으면 수집·발송을 모두 건너뜀(같은 날 두 번 오지 않음) |
| GitHub 예약 `5 20 * * *`(05:05)·`35 21 * * *`(06:35) | 예비. 실제로는 몇 시간 늦게 시작하고, 정시 실행이 끝냈으면 모두 건너뜀 |

어느 실행이든 주말·공휴일이면 첫 작업에서 끝납니다. 정시·예약 실행은 06:30 넘어 시작하면 끝나는 대로 바로 보냅니다. 시각을 바꿀 때는 외부 호출이 `not_before` 보다 15분 이상 앞서게 하세요
(호출 → 발송 준비 약 5분, 밤중처럼 110분 넘게 이르면 그 실행은 보내지 않고 다음 실행에 맡김).

## 쉬는 날 (주말·공휴일)

정시·예약 실행(cron-job.org 호출·GitHub 예약)은 토·일요일과 대한민국 관공서 공휴일에 브리핑을 만들지도 보내지도 않습니다.
워크플로의 첫 작업(**오늘 할지**)이 확인하고 바로 끝냅니다. **직접 실행**(Run workflow)은 쉬는 날에도 만들고 보냅니다.

- **공휴일 자료**: `src/holidays.mjs` 에 공식 월력요항(우주항공청 발표, [한국천문연구원 달력자료](https://astro.kasi.re.kr/kor/life/post/calendarData)) 기준으로
  2026·2027년 공휴일·대체공휴일·선거일을 넣어 두었습니다(2026년부터 공휴일이 된 노동절·제헌절 포함).
  확인: `node src/cli.mjs holidays 2027`
- **임시공휴일**: 정부가 새로 정하면 `config.json` 의 `schedule.extra_holidays` 에 `{"YYYY-MM-DD": "임시공휴일"}` 처럼 더합니다.
  더하지 않으면 그날도 평일처럼 보냅니다.
- **해마다 한 번**: 다음 해 월력요항은 6월 말쯤 발표됩니다. 그해 공휴일을 `src/holidays.mjs` 에 더하세요(시험이 대체공휴일 규칙에 맞는지 확인).
  자료가 없는 해가 되면 그해는 주말만 쉬고, 실행마다 경고를 남깁니다.
- **쉬고 온 날**: 월요일·연휴 다음 날 브리핑은 지난 브리핑 이후의 기사·신규 CVE·KEV·KISA 공지를 모두 모읍니다(최대 10일).
  머리에 '10.30(금) 브리핑 이후' 처럼 적힙니다. 이미 실은 CVE·기사는 빼고, 기사 제목은 바로 앞 두 번의 브리핑과 비교합니다.
  뉴스 RSS 는 최근 글만 주므로 긴 연휴의 앞쪽 기사는 빠질 수 있습니다.
- 매일 받으려면 `schedule.workdays_only` 를 `false` 로 바꿉니다.

## Claude 요약 (선택)

`ANTHROPIC_API_KEY` 가 있으면 하루 한 번 Claude 를 불러 후보 기사 40여 건과 취약점 목록에서
담당자가 볼 기사를 고르고, **해외 기사 제목·요약을 한국어로 옮기고**, 취약점 설명을 한국어로 정리합니다.
카카오톡의 [해외] 카드와 웹 페이지에는 번역한 제목이, 웹 페이지에는 원제도 함께 나옵니다.

**키 받기**: https://platform.claude.com/settings/keys 에서 API 키를 만들고(사용하려면 Billing 에서 크레딧을 충전),
저장소 Secrets 에 `ANTHROPIC_API_KEY` 로 넣으면 다음 실행부터 적용됩니다.

- 이 저장소는 `claude-haiku-5-5` 로 설정돼 있습니다. 하루 한 번 입력 1~2만 토큰·출력 수천 토큰이라
  월 0.1~0.2달러 수준입니다. 품질을 더 올리려면 `config.json` 의 `summarizer.model` 을 `claude-opus-5-5`(월 약 3~6달러)로.
  실제 사용 토큰은 브리핑 하단 '수집 상태'에 날마다 기록됩니다.
- 회사·제품·공격 그룹 이름은 번역하지 않고 원문 표기를 그대로 둡니다(예: Railway 를 '철도'로 옮기지 않음).
- CVE 번호·점수·링크·날짜는 코드가 원본에서 가져오고, Claude 는 문장만 씁니다.
  응답에 입력에 없는 CVE 번호나 기사 ID 가 섞이면 그 항목은 버리고 규칙 기반 문안을 씁니다.
- 실패(키 오류·한도·거절)해도 브리핑은 규칙 기반 문안(영문 원제)으로 나가고, 하단 수집 상태에 이유가 남습니다.
  Opus·Sonnet 은 안전 분류기가 거절하면 다른 모델로 자동 재시도(`fallbacks: "default"`)하고, Haiku 는 그 기능이 없어 규칙 기반 문안으로 대신합니다.
- Claude 에 보내는 것은 공개 기사 제목·요약과 공개 CVE 정보뿐입니다.

## 이전 브리핑 옮기기

이전 계정의 저장소나 `sec-brief-local` 의 `out/` 폴더(`daily-brief-YYYYMMDD.md`)를 받아 두었다면:

```powershell
node src/cli.mjs import C:\경로\out      # 하위 폴더까지 날짜가 든 .md/.txt 파일을 찾습니다
node src/cli.mjs build                   # 로컬에서 확인할 때
git add data; git commit -m "이전 브리핑 옮김"; git push
```

원문 그대로 '지난 형식 브리핑'으로 보여 주고, 맨 아래 `지난 브리핑 모아보기`(아티팩트 링크)는 뗍니다.
CVE 번호와 링크는 색인·검색에 들어갑니다. 같은 날짜에 새 형식 브리핑이 있으면 덮어쓰지 않습니다.

## 로컬에서 실행·미리 보기

```powershell
npm install                      # 처음 한 번 (Claude 요약을 쓸 때만 필요한 SDK)
node src/cli.mjs collect         # 오늘 브리핑 만들기 (--force 로 다시)
node src/cli.mjs build           # _site/ 웹 페이지
node src/cli.mjs serve           # http://localhost:8080
node src/cli.mjs preview         # 카카오톡으로 보낼 메시지(JSON)만 출력
node src/cli.mjs preview --mail  # 메일 제목 출력, 본문은 _site/mail-preview.html
node src/cli.mjs mail-login      # 처음 한 번: Outlook.com 계정 로그인(메일 발송 토큰)
node src/cli.mjs send --only mail --test   # 메일 연결만 확인
node src/cli.mjs holidays 2027   # 그해 공휴일(정시 실행이 쉬는 날) 목록
npm test                         # 자동 시험
```

비밀값은 `.env` 파일(저장소에 올라가지 않음)에 `KAKAO_REST_API_KEY=...` 꼴로 넣습니다.
**카카오 발송은 한 곳에서만** 하세요. GitHub 와 내 PC 가 같은 리프레시 토큰을 각자 갱신하면
한쪽 토큰이 만료됩니다. 평소에는 GitHub 가 보내고, 로컬은 `preview` 로 확인만 하는 것을 권합니다.

## 운영

- **실패 알림**: 워크플로가 실패하면 GitHub 가 메일을 보냅니다(기본 알림 설정). Actions 화면에서 원인을 봅니다.
  카카오톡과 메일은 따로 보내므로 하나가 실패해도 다른 하나는 갑니다. 실패한 쪽은 06:15 재호출이나 GitHub 예비 실행 때 한 번 더 보냅니다.
- **정시 호출 토큰**: cron-job.org 에 넣은 GitHub 토큰은 만든 지 1년에 만료됩니다. 만료 전에 새로 받아 바꾸세요([6. 정시에 받기](#6-정시에-받기--외부-예약-호출-권장-약-10분)).
  잊어도 GitHub 예비 실행이 늦게라도 보냅니다.
- **공휴일 자료**: 해마다 6월 말 다음 해 월력요항이 나오면 `src/holidays.mjs` 에 더합니다. 임시공휴일은 `config.json` 에([쉬는 날](#쉬는-날-주말공휴일)).
- **코드·설정을 고쳐 올리면**: `site` 워크플로가 웹 이력을 바로 다시 게시합니다(수집·발송은 하지 않음).
- **카카오 토큰**: 리프레시 토큰은 약 60일 유효하고, 남은 기간이 1개월 미만이 되면 갱신 응답에 새 값이 옵니다.
  새 값은 `data/kakao-state.json` 에 AES-256-GCM 으로 암호화해 커밋합니다(키는 `KAKAO_REFRESH_TOKEN` 에서 유도 —
  저장소만으로는 풀 수 없음). 매일 실행되는 한 다시 로그인할 일이 없습니다.
  다음 경우에는 `kakao-login` 을 다시 하고 `KAKAO_REFRESH_TOKEN` 을 바꾸세요: 한 달 넘게 실행이 멈췄을 때,
  카카오계정 비밀번호를 바꿨을 때, 앱 연결을 끊었을 때 (오류 메시지에 `KOE322` 가 보입니다).
- **같은 날 다시 보내기**: Run workflow 에서 '오늘 브리핑이 이미 있어도 다시 만들기' 를 체크합니다(카카오톡·메일 모두 다시).
  예약 실행은 같은 날짜를 두 번 보내지 않습니다.
- **예약 실행 중지**: 공개 저장소에 60일 동안 활동이 없으면 GitHub 가 예약 실행을 멈춥니다.
  이 도구는 매일 이력을 커밋하므로 해당되지 않지만, 멈췄다면 Actions 화면에서 다시 켭니다.
- **수집 실패**: 브리핑 하단 '수집 상태'를 보세요. 일시적인 오류는 다음 날 자동으로 회복되고,
  주소가 바뀐 RSS 는 `config.json` 의 `news.feeds` 에서 고칩니다. NVD 가 느리면 `NVD_API_KEY` 를 넣으세요.

## 보안

- 비밀값은 GitHub Secrets(로컬은 `.env`)에만 둡니다. 저장소에는 암호화된 카카오 상태 파일만 들어갑니다.
- 공개 저장소이므로 기관 내부 정보·자산 목록을 `config.json` 에 넣지 마세요(`vulns.watch` 에 제품명 정도는 무방하나 판단은 기관 기준으로).
- 워크플로의 액션은 커밋 해시로 고정했고, 작업별 권한을 최소로 줬으며, 입력값은 스크립트에 직접 넣지 않고 환경 변수로 넘깁니다.
- cron-job.org 에 맡기는 토큰은 이 저장소 하나에 Actions 권한만 가진 fine-grained 토큰입니다. 새어 나가도 코드·Secrets 는 건드릴 수 없지만
  워크플로를 실행·취소할 수는 있으니(예: '다시 만들기'로 같은 날 여러 번 발송), 의심되면 GitHub 에서 그 토큰을 지우고(Delete) 새로 만드세요.
  저장소의 다른 비밀값은 외부 서비스에 넘기지 않습니다.
- 웹 페이지는 외부 스크립트·글꼴을 쓰지 않고, 모든 글을 이스케이프하며, http(s) 주소만 링크로 만듭니다.
- RSS 는 DTD·외부 엔티티를 해석하지 않는 방식으로 읽고, 응답 크기·시간에 상한을 둡니다.
- `kakao-login` 의 임시 서버는 127.0.0.1 에서만 열리고, 요청 확인값(state)이 다른 요청은 무시합니다.
- 메일은 HTTPS(Outlook 메일 API) 또는 TLS(SMTP 465 SSL·587 STARTTLS 필수)로만 보내고, 본문의 외부 글은 모두 이스케이프하며 스크립트·외부 이미지를 넣지 않습니다.
  Outlook 은 메일 보내기(`Mail.Send`)와 기본 프로필 읽기 권한만 요청하고 받은 메일을 읽는 권한은 요청하지 않습니다.
  로그인은 클라이언트 비밀 없이 PKCE·확인값(state)으로 보호하고, Actions 기록에서는 토큰과 메일 주소를 가립니다.
  메일 주소·SMTP 계정은 Secrets 에만 있고 저장소에 남는 발송 기록에는 받는 사람 수만 적습니다.

## 파일 구성

```
sec-brief/
├── config.json                 설정 (비밀값 없음)
├── .github/workflows/
│   ├── daily-brief.yml         평일 수집·게시·발송 (06:00 외부 호출, GitHub 예약 05:05·06:35 는 예비)
│   ├── site.yml                코드를 바꾸면 웹 이력 다시 게시
│   └── test.yml                코드를 바꾸면 시험
├── src/
│   ├── cli.mjs                 명령 (run·collect·build·send·preview·kakao-login·import·serve)
│   ├── collect.mjs             하루치 수집·선별·저장
│   ├── sources/                CISA KEV · NVD · EPSS · RSS · 네이버
│   ├── news.mjs                기사 묶기(같은 사건)·점수·선별
│   ├── vulns.mjs               취약점 선별·묶기·한국어 문안
│   ├── vocab.mjs               CWE·취약점 유형 번역, 핵심어 가중치
│   ├── summarize.mjs           (선택) Claude 선별·요약과 응답 검증
│   ├── brief.mjs               Markdown·카카오 메시지
│   ├── kakao.mjs               토큰 갱신·암호화 보관·발송·로그인 도우미
│   ├── mail.mjs                (선택) 메일 본문·SMTP 발송
│   ├── outlook.mjs             (선택) Outlook.com 메일 API 발송·토큰 갱신·로그인 도우미
│   ├── holidays.mjs            대한민국 공휴일(월력요항)·쉬는 날 판단
│   ├── site.mjs, site-assets.mjs  웹 이력
│   ├── store.mjs               이력 저장·중복 방지(최근 브리핑에서 읽음)
│   └── legacy.mjs              이전 브리핑 옮기기
├── data/
│   ├── briefs/YYYY/            날짜별 브리핑 (.json 원자료 + .md 전문)
│   ├── kakao-state.json        카카오 토큰 상태 (암호화)
│   └── mail-state.json         메일 발송 기록 (날짜·받는 사람 수만)
└── test/                       자동 시험 (node --test)
```

## 자주 겪는 문제

| 증상 | 확인할 것 |
|---|---|
| 카카오 `KOE322` | 리프레시 토큰 만료·무효 → `kakao-login` 다시, `KAKAO_REFRESH_TOKEN` 교체 |
| 카카오 `KOE010` / `KOE101` | 클라이언트 시크릿 / REST API 키 값 |
| 카카오 `KOE006` (로그인 때) | 리다이렉트 URI 가 `http://localhost:8765/oauth` 와 글자까지 같은지 |
| 카카오 `-402` | 동의항목에서 카카오톡 메시지 전송 설정 후 `kakao-login` 다시 |
| 메시지는 오는데 버튼이 없음 | [제품 링크 관리] > [웹 도메인] 에 `https://<아이디>.github.io` 등록 |
| 카드를 눌렀더니 404 | 웹 게시가 실패했거나 아직 반영 전 — Actions 의 '웹 이력 게시' 작업과 Pages 설정(Source: GitHub Actions) |
| 브리핑에 '수집 실패' | 하단 수집 상태의 오류 문구. NVD 는 가끔 느리거나 점검 중입니다 |
| Outlook `invalid_grant` | 리프레시 토큰 만료·취소 → `mail-login` 다시, `OUTLOOK_REFRESH_TOKEN` 교체 |
| Outlook `AADSTS50011` (로그인 때) | 리디렉션 URI 를 '퍼블릭 클라이언트/네이티브(모바일 및 데스크톱)'에 `http://localhost` 로 등록했는지 |
| Outlook `AADSTS700016`·`unauthorized_client` | 애플리케이션 ID 값, 지원되는 계정 유형이 '개인 Microsoft 계정만'인지 |
| Outlook `ErrorAccessDenied` | API 사용 권한에 `Mail.Send` 추가 후 `mail-login` 다시 |
| Outlook `ErrorMessageSubmissionBlocked` | outlook.com 에 로그인해 계정 확인(휴대폰 등) 안내를 따름 |
| Outlook `ErrorAccountSuspend`, `service abuse mode` | Microsoft 가 스팸 의심으로 계정을 묶음(토큰 문제 아님) → account.microsoft.com 로그인·휴대폰 보안 코드로 풀기 → `mail-login` 다시, `OUTLOOK_REFRESH_TOKEN` 교체. 되풀이되면 Gmail 로 |
| 메일 `SMTP 로그인 실패` | Gmail 은 계정 비밀번호가 아니라 **앱 비밀번호**를 `SMTP_PASS` 에. 2단계 인증을 끄면 앱 비밀번호도 무효 |
| 메일 `연결하지 못했습니다` | `SMTP_HOST`·`SMTP_PORT` 값. 네이버는 해외 접속 차단 설정 |
| 메일이 안 보임 | 받는 쪽 스팸(정크) 메일함. Actions 로그에 '메일 발송 완료'가 있으면 보낸 것입니다 |
| 공휴일에 왔음 / 평일인데 안 옴 | Actions 의 **오늘 할지** 작업 안내 문구, `node src/cli.mjs holidays` 목록. 새 임시공휴일은 `schedule.extra_holidays` 에 |
| 메시지가 늦게 옴 | Actions 실행 이름이 **GitHub 예약 실행 (예비)** 면 정시 호출이 오지 않은 것 → cron-job.org 실행 기록(History)·토큰 만료일. **정시 실행 (외부 호출)** 이 06:00 이 아닌 때에 있으면 cron-job.org 작업의 시간대(Asia/Seoul) |
| cron-job.org 기록에 `401` | 토큰 만료·오타. `Authorization` 값이 `Bearer github_pat_…` 꼴인지(Bearer 뒤 한 칸) |
| cron-job.org 기록에 `403` | 토큰 권한이 Actions **Read and write** 인지, 저장소 선택에 `sec-brief` 가 있는지 |
| cron-job.org 기록에 `404` | URL 의 아이디·저장소·`daily-brief.yml` 글자, 토큰의 저장소 선택 |
| cron-job.org 기록에 `422` | 요청 본문이 `{"ref":"main","inputs":{"scheduled":"true"}}` 와 글자까지 같은지 |
