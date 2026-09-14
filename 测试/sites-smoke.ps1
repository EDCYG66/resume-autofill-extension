#!/usr/bin/env pwsh
# Scans fixtures built from the field labels real Chinese recruitment sites use, and reports how
# many columns the extension can resolve on its own.
#
# The fixtures are hand-transcribed from the live sites rather than downloaded, because every
# application form sits behind a login. What is reproduced here is the wording of each column,
# which is the part alias matching depends on. Keep this file in sync when a site renames a field.
#
# Run it after touching ALIASES or CONTEXT_LABELS in content.js: a drop here means real applicants
# would start seeing "资料里没有" on a site that used to work.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'sites-smoke-profile'
$stdout = Join-Path $tempRoot 'sites-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'sites-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$fixture = [Uri]::new((Join-Path $PSScriptRoot 'sites-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--virtual-time-budget=15000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
$match = [regex]::Match($dom, '<pre id="result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The sites fixture produced no result.' }
$data = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json

$cells = @($data.cells)
$exact = @($cells | Where-Object { $_.confidence -eq 'high' })
$medium = @($cells | Where-Object { $_.confidence -eq 'medium' })
$none = @($cells | Where-Object { $_.confidence -eq 'none' -or $_.isNewField })
$total = $cells.Count
$usable = [Math]::Round(($exact.Count + $medium.Count) / $total * 100)

Write-Output ("Site field coverage: {0} columns, {1} exact, {2} fuzzy, {3} unmatched -> {4}% usable" -f $total, $exact.Count, $medium.Count, $none.Count, $usable)

# A column only counts as covered when it resolves without the applicant having to intervene.
# 80% is the floor this project commits to; raise it when the alias table improves.
if ($usable -lt 80) {
  throw "Only $usable% of the transcribed site columns resolve. Unmatched: $(($none | ForEach-Object { $_.label }) -join ', ')"
}

# These are the columns the alias table is expected to get exactly right, with no confirmation
# step. They are listed per site so a regression names the site that broke.
$mustBeExact = @{
  '国聘' = @('姓名', '性别', '出生日期', '现居住地', '生源地', '期望职位', '期望行业', '最高学历')
  '智联招聘' = @('姓名', '性别', '出生日期', '手机号码', '电子邮箱', '毕业院校', '专业名称', '期望职位', '期望城市')
  '前程无忧' = @('姓名', '性别', '出生日期', '联系电话', '电子邮箱', '学历', '毕业学校', '专业')
  'BOSS直聘' = @('姓名', '性别', '出生日期', '手机号', '邮箱', '学历', '毕业院校', '专业', '期望职位', '期望城市')
  '猎聘' = @('姓名', '性别', '出生年月', '手机号', '邮箱', '学历', '学校', '专业', '期望职位', '期望城市')
  '实习僧' = @('姓名', '性别', '出生日期', '手机号', '邮箱', '学校', '专业', '学历')
  '牛客网' = @('姓名', '性别', '出生日期', '手机号', '邮箱', '学校', '专业', '学历')
  '应届生' = @('姓名', '性别', '出生日期', '手机号', '邮箱', '学校', '专业', '学历', '生源地')
}
$index = @{}
foreach ($cell in $cells) { if (-not $index.ContainsKey($cell.label)) { $index[$cell.label] = $cell } }
foreach ($site in $mustBeExact.Keys) {
  foreach ($label in $mustBeExact[$site]) {
    if (-not $index.ContainsKey($label)) { throw "$site column '$label' is missing from the fixture" }
    $cell = $index[$label]
    if ($cell.confidence -ne 'high') { throw "$site column '$label' resolved as '$($cell.confidence)' -> '$($cell.profileKey)'; it must resolve exactly" }
  }
}

# The fill must actually reach the page, and nothing may be submitted.
if ($data.state.submitAttempts -ne 0) { throw 'The fixture form was submitted.' }
$filled = @($data.state.values.PSObject.Properties | Where-Object { $_.Value }).Count
if ($filled -lt 60) { throw "Only $filled columns received a value; expected at least 60." }

Write-Output "Site field smoke test passed: $($exact.Count) columns exact, $($medium.Count) fuzzy, $filled values written, submitAttempts=0."
