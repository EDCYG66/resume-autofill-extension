# Drives the engine against shadow DOM and contenteditable controls: open shadow root (姓名 /
# 学历 / 性别), a nested shadow root (学校), a top-level contenteditable (自我评价) and one inside
# the nested root (期望职位).
#
# Run it after touching the control traversal in content.js: a shadow tree and a contenteditable
# are both invisible to a plain document.querySelectorAll, so a regression here means real sites
# built from web components silently keep their columns empty.
#
# Every value is read back out of the fixture's live DOM, so the expected wording is the real
# assertion and not a replay of what the driver passed in.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'shadow-smoke-profile'
$stdout = Join-Path $tempRoot 'shadow-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'shadow-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$fixture = [Uri]::new((Join-Path $PSScriptRoot 'shadow-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--virtual-time-budget=12000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

# -Encoding UTF8 is not optional: the fixture answers with Chinese values, and Windows PowerShell
# 5.1 would otherwise read the dump as ANSI and mangle every assertion.
$dom = Get-Content -Raw -LiteralPath $stdout -Encoding UTF8
$match = [regex]::Match($dom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The shadow fixture produced no result.' }
$result = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json

$expected = [ordered]@{
  shadowNameFilled = '测试姓名'
  shadowSelectFilled = '硕士'
  shadowGenderFilled = '男'
  nestedShadowSchoolFilled = '测试大学'
  editableFilled = '测试自我评价文本'
  editableInShadowFilled = '测试工程师'
}

$problems = @()
foreach ($key in $expected.Keys) {
  if ($result.$key -ne $expected[$key]) {
    $problems += "$key read back as '$($result.$key)', expected '$($expected[$key])'"
  }
}
# Six controls have to be visible to the scan at all: three in the open shadow root, one in the
# nested root, and the two contenteditables.
if ($result.scannedCount -lt 6) { $problems += "scannedCount was $($result.scannedCount); expected at least 6" }
if ($result.submitAttempts -ne 0) { $problems += "submitAttempts was $($result.submitAttempts); the fixture form was submitted" }
$failed = @($result.fillStatuses | Where-Object { $_ -eq 'failed' })
if ($failed.Count -gt 0) { $problems += "fill reported 'failed' for $($failed.Count) field(s)" }

if ($problems.Count -gt 0) {
  Write-Output 'Actual result JSON:'
  Write-Output ($result | ConvertTo-Json -Depth 5)
  throw ("Shadow DOM smoke test failed:`n  - " + ($problems -join "`n  - "))
}

Write-Output ("Shadow DOM smoke test passed: open and nested shadow roots plus contenteditable " +
  "filled; $($expected.Count) read-backs matched; scannedCount=$($result.scannedCount); submitAttempts=0.")
