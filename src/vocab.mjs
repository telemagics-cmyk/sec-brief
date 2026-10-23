// 한국어 문안 규칙에 쓰는 표: CWE·취약점 유형 번역, CNA 별 벤더 이름, 뉴스 핵심어 가중치.

export const CWE_KO = {
  'CWE-20': '입력값 검증 부적절', 'CWE-22': '경로 조작', 'CWE-23': '경로 조작', 'CWE-29': '경로 조작',
  'CWE-35': '경로 조작', 'CWE-36': '경로 조작', 'CWE-59': '링크 추적', 'CWE-61': '심볼릭 링크 추적',
  'CWE-74': '삽입', 'CWE-77': '명령 삽입', 'CWE-78': 'OS 명령 삽입', 'CWE-79': '크로스사이트 스크립팅(XSS)',
  'CWE-88': '인자 삽입', 'CWE-89': 'SQL 삽입', 'CWE-90': 'LDAP 삽입', 'CWE-91': 'XML 삽입',
  'CWE-94': '코드 삽입', 'CWE-95': '동적 코드 삽입', 'CWE-98': '원격 파일 포함', 'CWE-113': 'HTTP 응답 분할',
  'CWE-116': '출력 인코딩 부적절', 'CWE-119': '메모리 경계 오류', 'CWE-120': '버퍼 오버플로',
  'CWE-121': '스택 버퍼 오버플로', 'CWE-122': '힙 버퍼 오버플로', 'CWE-125': '범위 밖 읽기',
  'CWE-129': '배열 인덱스 검증 부적절', 'CWE-134': '형식 문자열', 'CWE-190': '정수 오버플로',
  'CWE-191': '정수 언더플로', 'CWE-200': '정보 노출', 'CWE-203': '정보 노출', 'CWE-209': '오류 메시지 정보 노출',
  'CWE-250': '과도한 권한 실행', 'CWE-256': '비밀번호 평문 저장', 'CWE-259': '하드코딩 비밀번호',
  'CWE-269': '권한 관리 부적절', 'CWE-276': '기본 권한 부적절', 'CWE-284': '접근 통제 부적절',
  'CWE-285': '권한 검사 부적절', 'CWE-287': '인증 부적절', 'CWE-288': '대체 경로 인증 우회',
  'CWE-290': '스푸핑 인증 우회', 'CWE-294': '재전송 인증 우회', 'CWE-295': '인증서 검증 부적절',
  'CWE-306': '중요 기능 인증 누락', 'CWE-307': '인증 시도 제한 없음', 'CWE-311': '중요 데이터 암호화 누락',
  'CWE-312': '중요 정보 평문 저장', 'CWE-319': '중요 정보 평문 전송', 'CWE-321': '하드코딩 암호 키',
  'CWE-326': '암호 강도 부족', 'CWE-327': '취약한 암호 알고리즘', 'CWE-330': '난수 생성 부적절',
  'CWE-345': '데이터 진위 검증 부족', 'CWE-346': '출처 검증 오류', 'CWE-347': '전자서명 검증 부적절',
  'CWE-352': '사이트 간 요청 위조(CSRF)', 'CWE-362': '경쟁 조건', 'CWE-367': '경쟁 조건(TOCTOU)',
  'CWE-384': '세션 고정', 'CWE-400': '자원 고갈', 'CWE-401': '메모리 누수', 'CWE-415': '이중 해제',
  'CWE-416': '해제 후 사용(UAF)', 'CWE-427': '검색 경로 조작', 'CWE-428': '따옴표 없는 검색 경로',
  'CWE-434': '위험한 형식 파일 업로드', 'CWE-444': 'HTTP 요청 스머글링', 'CWE-470': '안전하지 않은 리플렉션',
  'CWE-476': '널 포인터 역참조', 'CWE-494': '무결성 검사 없는 코드 내려받기', 'CWE-497': '시스템 정보 노출',
  'CWE-502': '신뢰할 수 없는 데이터 역직렬화', 'CWE-522': '인증정보 보호 부족', 'CWE-532': '로그 정보 노출',
  'CWE-552': '외부 접근 가능 파일', 'CWE-601': '오픈 리다이렉트', 'CWE-611': 'XML 외부 개체(XXE)',
  'CWE-613': '세션 만료 부적절', 'CWE-639': '권한 우회(IDOR)', 'CWE-640': '비밀번호 복구 취약',
  'CWE-668': '잘못된 영역에 자원 노출', 'CWE-670': '제어 흐름 오류', 'CWE-674': '무제한 재귀',
  'CWE-693': '보호 기능 실패', 'CWE-703': '예외 처리 부적절', 'CWE-704': '형 변환 오류',
  'CWE-732': '중요 자원 권한 설정 오류', 'CWE-749': '위험한 메서드 노출', 'CWE-754': '예외 조건 검사 부적절',
  'CWE-770': '자원 할당 제한 없음', 'CWE-772': '자원 해제 누락', 'CWE-787': '범위 밖 쓰기',
  'CWE-798': '하드코딩 인증정보', 'CWE-822': '신뢰할 수 없는 포인터 역참조', 'CWE-829': '신뢰할 수 없는 기능 포함',
  'CWE-835': '무한 루프', 'CWE-843': '타입 혼동', 'CWE-862': '권한 검사 누락', 'CWE-863': '권한 검사 오류',
  'CWE-908': '초기화되지 않은 자원 사용', 'CWE-912': '숨겨진 기능', 'CWE-913': '동적 코드 제어 부적절',
  'CWE-915': '객체 속성 수정 통제 부적절', 'CWE-917': '표현 언어 삽입', 'CWE-918': '서버 측 요청 위조(SSRF)',
  'CWE-922': '중요 정보 저장 부적절', 'CWE-1021': '클릭재킹', 'CWE-1188': '안전하지 않은 기본값',
  'CWE-1236': 'CSV 수식 삽입', 'CWE-1321': '프로토타입 오염', 'CWE-1333': '정규식 서비스 거부(ReDoS)',
  'CWE-1336': '템플릿 삽입',
};

// 긴 표현부터 바꾼다 (Injection 보다 SQL Injection 이 먼저).
export const VULN_PHRASES_KO = [
  // CWE 정식 이름으로 붙는 KEV 제목들
  [/external control of file name or path/gi, '파일 이름·경로 외부 제어'],
  [/uncontrolled search path element/gi, '검색 경로 조작'],
  [/improper neutralization of encoded uri schemes in a web page/gi, 'URI 스킴 필터링 부적절(XSS)'],
  [/improper neutralization of encoded uri schemes/gi, 'URI 스킴 필터링 부적절'],
  [/improper neutralization of input during web page generation/gi, '크로스사이트 스크립팅(XSS)'],
  [/improper neutralization of special elements used in an os command/gi, 'OS 명령 삽입'],
  [/improper neutralization of special elements used in a command/gi, '명령 삽입'],
  [/improper neutralization of special elements used in an sql command/gi, 'SQL 삽입'],
  [/improper limitation of a pathname to a restricted directory/gi, '경로 조작'],
  [/improper control of generation of code/gi, '코드 삽입'],
  [/improper restriction of xml external entity reference/gi, 'XML 외부 개체(XXE)'],
  [/improper restriction of operations within the bounds of a memory buffer/gi, '메모리 경계 오류'],
  [/exposure of sensitive information to an unauthorized actor/gi, '중요 정보 노출'],
  [/insufficiently protected credentials/gi, '인증정보 보호 부족'],
  [/incorrect default permissions/gi, '기본 권한 부적절'],
  [/improper privilege management/gi, '권한 관리 부적절'],
  [/improper link resolution before file access/gi, '링크 추적'],
  [/files or directories accessible to external parties/gi, '외부 접근 가능 파일'],
  [/download of code without integrity check/gi, '무결성 검사 없는 코드 내려받기'],
  [/embedded malicious code/gi, '악성코드 내장'],
  [/remote code execution/gi, '원격 코드 실행'],
  [/arbitrary code execution/gi, '임의 코드 실행'],
  [/code execution/gi, '코드 실행'],
  [/os command injection/gi, 'OS 명령 삽입'],
  [/command injection/gi, '명령 삽입'],
  [/sql injection/gi, 'SQL 삽입'],
  [/server[- ]side template injection/gi, '서버 측 템플릿 삽입'],
  [/template injection/gi, '템플릿 삽입'],
  [/expression language injection/gi, '표현 언어 삽입'],
  [/code injection/gi, '코드 삽입'],
  [/deserialization of untrusted data/gi, '신뢰할 수 없는 데이터 역직렬화'],
  [/(insecure )?deserialization/gi, '역직렬화'],
  [/missing authentication for critical function/gi, '중요 기능 인증 누락'],
  [/missing authentication/gi, '인증 누락'],
  [/authentication bypass( by [a-z -]+)?/gi, '인증 우회'],
  [/improper authentication/gi, '부적절한 인증'],
  [/missing authorization/gi, '권한 검사 누락'],
  [/incorrect authorization/gi, '잘못된 권한 검사'],
  [/improper access control/gi, '부적절한 접근 통제'],
  [/(privilege escalation|elevation of privilege)/gi, '권한 상승'],
  [/(path|directory) traversal/gi, '경로 조작'],
  [/unrestricted upload of file with dangerous type/gi, '위험한 형식 파일 업로드'],
  [/(arbitrary|unrestricted) file upload/gi, '임의 파일 업로드'],
  [/arbitrary file (read|reading)/gi, '임의 파일 읽기'],
  [/arbitrary file (write|writing)/gi, '임의 파일 쓰기'],
  [/arbitrary file (deletion|delete)/gi, '임의 파일 삭제'],
  [/server[- ]side request forgery( \(ssrf\))?/gi, '서버 측 요청 위조(SSRF)'],
  [/cross[- ]site request forgery( \(csrf\))?/gi, '사이트 간 요청 위조(CSRF)'],
  [/cross[- ]site scripting( \(xss\))?/gi, '크로스사이트 스크립팅(XSS)'],
  [/use[- ]after[- ]free/gi, '해제 후 사용(UAF)'],
  [/out[- ]of[- ]bounds write/gi, '범위 밖 쓰기'],
  [/out[- ]of[- ]bounds read/gi, '범위 밖 읽기'],
  [/heap[- ]based buffer overflow/gi, '힙 버퍼 오버플로'],
  [/stack[- ]based buffer overflow/gi, '스택 버퍼 오버플로'],
  [/buffer overflow/gi, '버퍼 오버플로'],
  [/integer overflow/gi, '정수 오버플로'],
  [/type confusion/gi, '타입 혼동'],
  [/memory corruption/gi, '메모리 손상'],
  [/race condition/gi, '경쟁 조건'],
  [/(use of )?hard[- ]?coded credentials?/gi, '하드코딩된 인증정보'],
  [/(sensitive )?information disclosure/gi, '정보 노출'],
  [/denial[- ]of[- ]service/gi, '서비스 거부'],
  [/security feature bypass/gi, '보안 기능 우회'],
  [/improper input validation/gi, '입력값 검증 부적절'],
  [/improper certificate validation/gi, '인증서 검증 부적절'],
  [/open redirect/gi, '오픈 리다이렉트'],
  [/xml external entity( \(xxe\))?/gi, 'XML 외부 개체(XXE)'],
  [/prototype pollution/gi, '프로토타입 오염'],
  [/link following/gi, '링크 추적'],
  [/unspecified/gi, '세부 미공개'],
  [/\bmultiple\b/gi, '복수'],
  [/\bvulnerabilit(y|ies)\b/gi, '취약점'],
];

export function translateVulnName(s) {
  let out = String(s ?? '');
  for (const [re, ko] of VULN_PHRASES_KO) out = out.replace(re, ko);
  return out.replace(/\s+/g, ' ').trim();
}

// NVD sourceIdentifier(CNA) → 벤더 이름. 모르는 CNA 는 CPE·설명에서 찾는다.
export const CNA_VENDOR = {
  'psirt@cisco.com': 'Cisco', 'secure@microsoft.com': 'Microsoft', 'security-alert@hpe.com': 'HPE',
  'psirt@fortinet.com': 'Fortinet', 'cve@gitlab.com': 'GitLab', 'psirt@arista.com': 'Arista',
  'psirt@okta.com': 'Okta', 'security@joomla.org': 'Joomla', 'cve-coordination@google.com': 'Google',
  'chrome-cve-admin@google.com': 'Google Chrome', 'security@android.com': 'Android',
  'psirt@paloaltonetworks.com': 'Palo Alto Networks', 'security@apache.org': 'Apache',
  'secalert_us@oracle.com': 'Oracle', 'psirt@adobe.com': 'Adobe', 'security@atlassian.com': 'Atlassian',
  'product-security@apple.com': 'Apple', 'security@mozilla.org': 'Mozilla', 'psirt@sonicwall.com': 'SonicWall',
  'sirt@juniper.net': 'Juniper', 'f5sirt@f5.com': 'F5', 'security_alert@emc.com': 'Dell', 'secure@dell.com': 'Dell',
  'psirt@huawei.com': 'Huawei', 'psirt@ivanti.com': 'Ivanti', 'secure@citrix.com': 'Citrix',
  'security@vmware.com': 'VMware', 'psirt@us.ibm.com': 'IBM', 'security@hashicorp.com': 'HashiCorp',
  'security@zyxel.com.tw': 'Zyxel', 'security@synology.com': 'Synology', 'security@qnap.com': 'QNAP',
  'psirt@lenovo.com': 'Lenovo', 'secure@intel.com': 'Intel', 'psirt@amd.com': 'AMD', 'psirt@nvidia.com': 'NVIDIA',
  'security@ubuntu.com': 'Canonical', 'secalert@redhat.com': 'Red Hat', 'cve@kernel.org': 'Linux kernel',
  'security@php.net': 'PHP', 'security@progress.com': 'Progress', 'productcert@siemens.com': 'Siemens',
  'cybersecurity@se.com': 'Schneider Electric', 'mlhess@drupal.org': 'Drupal', 'infosec@edk2.groups.io': 'EDK2',
  'mobile.security@samsung.com': 'Samsung', 'vuln@krcert.or.kr': 'KISA', 'security@wordfence.com': 'WordPress 플러그인',
  'audit@patchstack.com': 'WordPress 플러그인', 'psirt@zscaler.com': 'Zscaler', 'security@checkpoint.com': 'Check Point',
  'security@veeam.com': 'Veeam', 'psirt@sap.com': 'SAP', 'cna@sap.com': 'SAP', 'security@splunk.com': 'Splunk',
  'bressers@elastic.co': 'Elastic', 'security@synacor.com': 'Zimbra', 'psirt@tp-link.com': 'TP-Link',
};

// CNA 이지만 제품 벤더가 아닌 곳(조정 기관·취합처). 제목에 쓰지 않는다.
export const COORDINATOR_CNAS = new Set([
  'disclosure@vulncheck.com', 'security-advisories@github.com', 'cna@vuldb.com', 'cve@mitre.org',
  'ics-cert@hq.dhs.gov', 'vultures@jpcert.or.jp', 'cret@cert.org', 'cert@cert.org', 'audit@patchstack.com',
  'security@wordfence.com', 'vuln@krcert.or.kr', 'help@fluidattacks.com', 'cve@usom.gov.tr',
]);

// 뉴스 핵심어 가중치. 같은 묶음은 한 번만 더한다.
export const NEWS_WEIGHTS = [
  [3, /랜섬웨어|ransomware/i],
  [3, /제로데이|zero[- ]?day|0-day/i],
  [3, /악용|exploited|in the wild|actively exploit/i],
  [3, /해킹|해커|hack(ed|er|ers|ing)?\b/i],
  [3, /유출|leak(ed|s)?\b|breach(ed|es)?\b|exposed/i],
  [3, /침해|compromis/i],
  [3, /공급망|supply[- ]chain/i],
  [3, /북한|north korea|lazarus|kimsuky|국가 ?배후|state[- ]sponsored|nation[- ]state/i],
  [2, /긴급|urgent|emergency/i],
  [2, /디도스|ddos/i],
  [2, /탈취|stolen|steal|theft/i],
  [2, /취약점|vulnerabilit|flaw|bug\b|cve-\d{4}/i],
  [2, /패치|보안 ?업데이트|patch(es|ed)?\b|security update/i],
  [2, /악성코드|악성 ?앱|malware|backdoor|백도어|infostealer|stealer|trojan|트로이|botnet|봇넷|웜\b|worm\b/i],
  [2, /피싱|스미싱|phishing|smishing/i],
  [2, /사이버 ?공격|cyber ?attack|attack(s|ed)?\b|공격/i],
  [2, /개인정보|personal (data|information)|credentials?|크리덴셜|계정 정보/i],
  [2, /apt\b|apt\d+|threat actor|위협 그룹|해킹 그룹|해킹조직/i],
  [1, /보안|security/i],
  [1, /경고|주의|권고|warn(s|ing)?\b|advisory|alert/i],
  [1, /cisa\b|kisa\b|국정원|경찰|수사|체포|기소|arrest|indict|sanction|제재|fbi\b/i],
];

// 공공 부문 관련 표현(국내 기사): 가점.
export const PUBLIC_SECTOR = /공공|정부|부처|행정|지자체|공단|공사\b|국가기관|국방|국정원|과기정통부|개인정보위|행안부|교육청/;

// 홍보·행사·인사·투자 기사: 감점.
export const NEWS_NOISE = [
  /창립|기념식|협찬|시상|수상|선정|론칭|체결|업무 ?협약|\bmou\b|협약식|개최|행사|세미나|컨퍼런스|콘퍼런스|웨비나|박람회|전시회|참가|모집|채용|인사\]|부고|동정|할인|이벤트|투자 유치|시리즈 ?[a-d]|상장|주가|실적|매출|신제품|출시/i,
  /\[(인터뷰|기고|칼럼|사설|오피니언|포토|카드뉴스|기획|주간|시황|부고|인사)\]/,
  /공모주|청약|\bipo\b|맞손|공동 ?(공략|추진)|협력 ?(확대|논의|강화|방안)|사업 ?(확대|추진)|특허 ?취득|솔루션 ?(공개|발표)|파트너십|총판|기념 ?행사/i,
  // 제품·서비스 출시: '탈레스 ‘센티넬 엔벨로프 플러스’ 발표', '진단 스캐너 공개', '보호 솔루션 출시'
  /(솔루션|제품|플랫폼|신규 ?버전|서비스|기능|스캐너|센서|패키지|어플라이언스)\S{0,3} ?(을|를)? ?(발표|공개|출시|선보|오픈|론칭|배포)|[‘'"“][^‘'"“”’]{2,30}[’'"”] ?(발표|출시|선보|론칭)|기술 ?전략 ?공개|역량 ?강화/,
  /webinar|podcast|sponsored|\bdeals?\b|discount|raises \$|funding|acquires|acquisition|merger|partnership|appoints|names .* (ceo|cto|ciso)|award|conference|summit|week in review|in other news|interview|hacker conversations|\bm&a\b|how to\b|best .* (tools|apps)/i,
  // 여러 소식을 모은 주간·일간 정리 기사
  /threatsday|weekly recap|week in security|this week in|\+ ?\d+ more\b|news roundup|recap:|주간 ?(보안|이슈|동향)|위클리/i,
];

// 날마다 다른 기사에도 흔히 나오는 영어 낱말: 같은 사건 판정(고유명사 공유)에 쓰지 않는다.
export const COMMON_EN = new Set(
  ('security cyber cybersecurity attack attacks attacker attackers hacker hackers hacked hacking breach breaches ' +
    'ransomware malware phishing stealer infostealer exploit exploits exploited exploiting vulnerability vulnerabilities ' +
    'critical warns warning patch patches patched update updates release released malicious campaign campaigns group ' +
    'groups threat threats actor actors linked state chinese russian north korean iranian china russia korea iran ' +
    'government agency agencies company companies customers users accounts million billion data leak leaked network ' +
    'networks systems access remote supply chain zero-day researchers research report service services software ' +
    'microsoft google apple android windows linux cloud amazon meta github openai federal police authorities arrested ' +
    'servers server devices device flaw flaws bug bugs credentials passwords targeting targets target spyware botnet ' +
    'code execution remote injection severity maximum bypass authentication privilege escalation version versions ' +
    'supported decoder warns alert alerts fixes fixed zero-days attacked compromised exposed stolen theft ransom ' +
    'backdoor exploitation actively active massive global major latest first million thousands hundreds sentenced ' +
    'charged arrest seized takedown customer secrets tokens token keys credential password phishing-as-a-service ' +
    'vulnerable unpatched emergency urgent hijack hijacked abuse abused abusing operation operations infrastructure ' +
    // 흔한 약어: 고유명사처럼 보이지만 여러 사건에 두루 쓰인다
    'api apis sbom sql dns vpn mfa sso otp iot ict ceo cto ciso cpo llm llms saas paas iaas edr xdr ndr mdr siem soar ' +
    'soc cert csirt isms gdpr poc rce xss csrf ssrf ddos apt msp mssp smb rdp ssh ftp http https tls ssl pki usb cpu gpu ' +
    'ics scada plc url uri erp crm dbms kisa cisa fbi nsa nis ncsc nist cve cves cvss epss kev ai-powered genai')
    .split(' '),
);
