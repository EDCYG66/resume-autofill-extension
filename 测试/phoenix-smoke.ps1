# Drives the engine against the 中国兵器工业集团 recruitment form, whose ATS is built on the
# "phoenix" design system. The bug this covers: every dropdown on that page stayed empty.
#
# What makes the page hard is that nothing names a control the usual way. The field name sits only
# in <label class="form-item__text">, the dropdown's <input> has no name/id/aria-label and an empty
# placeholder, and the option rows carry neither role="option" nor data-value. The panel only exists
# after the trigger is clicked. 性别 is a radio group made of plain divs with no <input> at all, and
# 生源地 runs a province -> city -> 确定 cascade whose displayed value does not move until 确定.
#
# Run it after touching label resolution, custom select handling or choice groups in content.js: a
# failure here means real applicants on that site keep seeing empty dropdowns.
#
# Every value below is read back out of the fixture's live DOM, so a value the engine did not write
# comes back "" and fails the smoke test instead of passing silently.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'phoenix-smoke-profile'
$stdout = Join-Path $tempRoot 'phoenix-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'phoenix-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$fixture = [Uri]::new((Join-Path $PSScriptRoot 'phoenix-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=15000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

# -Encoding UTF8 is not optional: the fixture answers with Chinese values, and Windows PowerShell
# 5.1 would otherwise read the dump as ANSI and mangle every assertion.
$dom = Get-Content -Raw -LiteralPath $stdout -Encoding UTF8
$match = [regex]::Match($dom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The phoenix fixture produced no result.' }
$result = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
if (-not $result) { throw 'The phoenix fixture produced an empty result.' }

# 学历 is 硕士 in the profile and 硕士研究生 in the list; 生源地 is 辽宁-锦州-黑山县 there and
# 辽宁省/锦州市 on the page, so the expectations also cover the wording gaps between the two.
$expected = [ordered]@{
  nameFilled = '测试姓名'
  studyLevelFilled = '硕士研究生'
  politicalStatusFilled = '共青团员'
  ethnicityFilled = '汉族'
  genderFilled = '男'
  originRegionFilled = '辽宁省/锦州市'
}

$problems = @()
foreach ($key in $expected.Keys) {
  if ($result.$key -ne $expected[$key]) {
    $problems += "$key read back as '$($result.$key)', expected '$($expected[$key])'"
  }
}
# Six fields have to be visible to the scan at all: 姓名, 学历, 政治面貌, 民族, 性别, 生源地.
if ($result.scannedCount -lt 5) { $problems += "scannedCount was $($result.scannedCount); expected at least 5" }
if ($result.submitAttempts -ne 0) { $problems += "submitAttempts was $($result.submitAttempts); the fixture form was submitted" }
 # The confirm step of the region picker must click the picker's own 确定 and nothing else. Both
 # decoys sit earlier in the document than the panel: 保存 guards the wording, 确认 guards the
 # search scope, and a page-wide search would hit one of them.
 if ($result.decoySaveClicks -ne 0) { $problems += "the page's own 保存 button was clicked $($result.decoySaveClicks) time(s)" }
 if ($result.decoyConfirmClicks -ne 0) { $problems += "a button outside the picker panel was clicked $($result.decoyConfirmClicks) time(s)" }
 $failed = @($result.fillStatuses | Where-Object { $_ -eq 'failed' })
 if ($failed.Count -gt 0) { $problems += "fill reported 'failed' for $($failed.Count) field(s)" }
 
 if ($problems.Count -gt 0) {
   Write-Output 'Actual result JSON:'
   Write-Output ($result | ConvertTo-Json -Depth 5)
   throw ("Phoenix form smoke test failed:`n  - " + ($problems -join "`n  - "))
 }

Write-Output ("Phoenix form smoke test passed: phoenix-select dropdowns, the phoenix-radio-group and " +
  "the province/city cascade filled; $($expected.Count) read-backs matched; " +
  "scannedCount=$($result.scannedCount); submitAttempts=0.")
