$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$chrome = Get-TestBrowserOrThrow
$sourceHtml = 'C:\Users\Gao Yilong\Desktop\中国三星招聘.html'
$sourceAssets = 'C:\Users\Gao Yilong\Desktop\中国三星招聘_files'
if (-not (Test-Path -LiteralPath $sourceHtml -PathType Leaf)) { throw "Snapshot HTML was not found: $sourceHtml" }
if (-not (Test-Path -LiteralPath $sourceAssets -PathType Container)) { throw "Snapshot assets were not found: $sourceAssets" }

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('resume-samsung-' + [guid]::NewGuid().ToString('N'))
$stdout = Join-Path $tempRoot 'stdout.txt'
$stderr = Join-Path $tempRoot 'stderr.txt'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  Copy-Item -LiteralPath $sourceAssets -Destination (Join-Path $tempRoot '中国三星招聘_files') -Recurse
  $raw = Get-Content -LiteralPath $sourceHtml -Raw -Encoding UTF8
  $content = Get-Content -LiteralPath (Join-Path $root 'content.js') -Raw -Encoding UTF8
  $probe = @'
(function () {
  var profile = {
    basic: {
      name: '三星测试姓名', gender: '男', birth_date: '2001-06-03', phone: '13800138000',
      email: 'samsung@example.com', current_residence: '北京', place_of_origin: '北京',
      political_status: '共青团员', ethnicity: '汉族', marital_status: '未婚',
      native_place: '北京', household_registration: '北京', height: '178', weight: '75',
      id_type: '身份证', has_children: '无'
    },
    intention: {
      target_role: '算法工程师', city: '北京', industry: '电子半导体', salary: '15000',
      employment_type: '全职', available_date: '2027-07'
    },
    education: [{
      level: '硕士', school: '测试大学', major: '电子信息', major_category: '电子信息',
      end_date: '2027-06', start_date: '2024-09', study_mode: '全日制', admission_type: '统招',
      graduate_type: '应届', college: '测试学院', degree_name: '工学硕士',
      english_level: '大学英语六级', english_score: '528', research_direction: '智能系统'
    }],
    employment: [{ employer: '测试公司', role: '算法工程师', start_date: '2023-07', end_date: '2024-08', location: '北京', description: '测试工作内容' }],
    projects: [{ name: '测试项目', role: '负责人', organization: '测试单位', introduction: '测试项目介绍', outcomes: '测试项目成果' }],
    skills: [{ category: '英语', name: '大学英语六级', level: '熟练' }],
    additional: { hobbies: '摄影', specialty: '长跑', punishment: '无', law_violation: '否', applied_subsidiary: '否', relatives_in_company: '否', medical_history: '否' },
    self_evaluation: '三星快照自动填充测试'
  };
  var form = document.querySelector('form');
  window.__samsungSubmitAttempts = 0;
  if (form) form.addEventListener('submit', function (event) { event.preventDefault(); window.__samsungSubmitAttempts += 1; });
  var candidates = ResumeContent.scan(profile, { siteKey: 'file://samsung-snapshot' });
  var summary = {
    candidateCount: candidates.length,
    matchedCount: candidates.filter(function (item) { return item.profileKey && item.proposedValue && !item.isNewField; }).length,
    highCount: candidates.filter(function (item) { return item.confidence === 'high'; }).length,
    mediumCount: candidates.filter(function (item) { return item.confidence === 'medium'; }).length,
    newCount: candidates.filter(function (item) { return item.isNewField; }).length,
    sensitiveCount: candidates.filter(function (item) { return item.sensitive; }).length,
    controlTypes: candidates.reduce(function (map, item) { map[item.controlType] = (map[item.controlType] || 0) + 1; return map; }, {}),
    labels: candidates.map(function (item) { return { label: item.label, profileKey: item.profileKey || '', confidence: item.confidence, controlType: item.controlType, isNewField: Boolean(item.isNewField), sensitive: Boolean(item.sensitive) }; }),
    diagnostics: ResumeContent.getDiagnostics()
  };
  var fillable = candidates.filter(function (item) { return item.profileKey && item.proposedValue && !item.isNewField && !item.sensitive; });
  var firstPhoenixInput = document.querySelector('.phoenix-select__input');
  if (firstPhoenixInput) ResumeContent.dispatchOpenSequence(firstPhoenixInput);
  ResumeContent.fill(fillable).then(function (results) {
    summary.fill = {
      requested: fillable.length,
      filled: results.filter(function (item) { return item.status === 'filled'; }).length,
      failed: results.filter(function (item) { return item.status === 'failed'; }).length,
      skipped: results.filter(function (item) { return item.status === 'skipped'; }).length,
      statuses: results.map(function (item) { return item.status; }),
      phoenixOptionCount: document.querySelectorAll('.phoenix-selectList__listItem').length,
      failedFields: results.filter(function (item) { return item.status === 'failed'; }).map(function (item) {
        var candidate = candidates.find(function (field) { return field.id === item.id; });
        return { label: candidate ? candidate.label : '', profileKey: candidate ? (candidate.profileKey || '') : '', controlType: candidate ? candidate.controlType : '', reason: item.reason || '' };
      })
    };
    summary.submitAttempts = window.__samsungSubmitAttempts;
    var pre = document.createElement('pre');
    pre.id = 'codex-samsung-result';
    pre.textContent = JSON.stringify(summary);
    document.body.appendChild(pre);
  }, function (error) {
    var pre = document.createElement('pre');
    pre.id = 'codex-samsung-result';
    pre.textContent = JSON.stringify({ error: String(error && error.stack || error), diagnostics: summary.diagnostics });
    document.body.appendChild(pre);
  });
}());
'@
  $injected = '<script>' + $content + "`n" + $probe + '</script>'
  $bodyIndex = $raw.LastIndexOf('</body>', [StringComparison]::OrdinalIgnoreCase)
  if ($bodyIndex -lt 0) { throw 'The Samsung snapshot has no closing body tag.' }
  $copyHtml = $raw.Substring(0, $bodyIndex) + $injected + $raw.Substring($bodyIndex)
  $htmlPath = Join-Path $tempRoot '中国三星招聘.html'
  [IO.File]::WriteAllText($htmlPath, $copyHtml, [Text.UTF8Encoding]::new($false))
  $fixture = [Uri]::new($htmlPath).AbsoluteUri
  $process = Start-Process -FilePath $chrome -ArgumentList @(
    '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
    (Quote-Arg "--user-data-dir=$tempRoot\profile"), '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=20000', '--dump-dom', $fixture
  ) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if ($process.ExitCode -ne 0) { throw "Chrome exited with code $($process.ExitCode)." }
  $dom = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8
  $match = [regex]::Match($dom, '<pre id="codex-samsung-result">(.*?)</pre>', [Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $match.Success) {
    $stderrText = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw -Encoding UTF8 } else { '' }
    throw "The Samsung snapshot did not produce a probe result (DOM chars=$($dom.Length), stderr chars=$($stderrText.Length), exit=$($process.ExitCode))."
  }
  $data = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
  if ($data.error) { throw "Samsung snapshot probe failed: $($data.error)" }
  $data | ConvertTo-Json -Depth 8
}
finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
