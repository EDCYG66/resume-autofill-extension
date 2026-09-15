# Drives the engine against a form whose record sections repeat: two rows of 教育经历 carrying the
# same column wording and the same name attributes, a column whose current content mentions
# 上传/确认, and a column nothing matches that the popup assigns by hand.
#
# Run it after touching the scan's candidate identity (dedupeFieldDescriptors / controlScope),
# isSubmitLike, or the guard at the top of fill(): each of those three is a way for a real column to
# disappear from the popup or to be reported as skipped while the applicant is told it can be filled.
#
# Every value is read back out of the fixture's live DOM, so the assertion is the value the page
# really holds, not a replay of what the driver passed in.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'repeat-record-smoke-profile'
$stdout = Join-Path $tempRoot 'repeat-record-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'repeat-record-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$fixture = [Uri]::new((Join-Path $PSScriptRoot 'repeat-record-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--virtual-time-budget=12000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

# -Encoding UTF8 is not optional: the fixture answers with Chinese values, and Windows PowerShell
# 5.1 would otherwise read the dump as ANSI and mangle every assertion.
$dom = Get-Content -Raw -LiteralPath $stdout -Encoding UTF8
$match = [regex]::Match($dom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The repeated record fixture produced no result.' }
$result = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json

$problems = @()
if ($result.error) { $problems += "the fixture threw: $($result.error)" }

# 1. Both rows of the repeated section survive the scan and get their own record's value. Merging
#    them by wording alone left the second row with no candidate and an empty box.
if ($result.startTimeCount -ne 2) { $problems += "startTimeCount was $($result.startTimeCount); both rows of 教育经历 must be scanned" }
if ($result.edu1Start -ne '2021-09') { $problems += "edu1-start read back as '$($result.edu1Start)', expected '2021-09'" }
if ($result.edu2Start -ne '2017-09') { $problems += "edu2-start read back as '$($result.edu2Start)', expected '2017-09'" }
if ($result.edu1School -ne '第一大学') { $problems += "edu1-school read back as '$($result.edu1School)', expected '第一大学'" }
if ($result.edu2School -ne '第二大学') { $problems += "edu2-school read back as '$($result.edu2School)', expected '第二大学'" }

# 2. The column whose current content says 上传与确认 is data, not a submit button: it has to stay in
#    the scan and take the profile value.
if ($result.selfEvaluationScanned -ne $true) { $problems += '自我评价 was dropped from the scan; a column is not a submit button just because its current content says 上传/确认' }
if ($result.selfEvaluation -ne '负责服务端开发与维护') { $problems += "自我评价 read back as '$($result.selfEvaluation)', expected '负责服务端开发与维护'" }

# 3. The hand-assigned column reaches fill() and the value lands, instead of coming back 'skipped'.
if ($result.assignedScanned -ne $true) { $problems += 'The unmatched 学习经历 column never appeared in the scan.' }
if ($result.assignedWouldSend -ne $true) { $problems += 'The driver could not build the payload popup.js sends for an assigned column.' }
if ($result.assignedValue -ne '测试姓名') { $problems += "The assigned column reads back as '$($result.assignedValue)', expected '测试姓名'; popup.js sends it but fill() refused it" }

$failed = @($result.fillStatuses | Where-Object { $_ -eq 'failed' })
if ($failed.Count -gt 0) { $problems += "fill reported 'failed' for $($failed.Count) field(s)" }
$skippedAssigned = @($result.assignedFillStatuses | Where-Object { $_ -eq 'skipped' })
if ($skippedAssigned.Count -gt 0) { $problems += "fill skipped the hand-assigned column ($($result.assignedFillStatuses -join ','))" }

# Nothing may submit the form, in either fill pass.
if ($result.submitAttempts -ne 0) { $problems += "submitAttempts was $($result.submitAttempts); the fixture form was submitted" }

if ($problems.Count -gt 0) {
  Write-Output 'Actual result JSON:'
  Write-Output ($result | ConvertTo-Json -Depth 5)
  throw ("Repeated record smoke test failed:`n  - " + ($problems -join "`n  - "))
}

Write-Output ("Repeated record smoke test passed: $($result.startTimeCount) same-wording rows filled with " +
  "their own values; a column mentioning 上传/确认 stayed scannable; a hand-assigned column filled " +
  "instead of being skipped; scannedCount=$($result.scannedCount); submitAttempts=0.")
