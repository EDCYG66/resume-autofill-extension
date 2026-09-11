$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$chrome = Get-TestBrowserOrThrow
$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'frame-smoke-profile'
$stdout = Join-Path $tempRoot 'frame-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'frame-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$fixture = [Uri]::new((Join-Path $PSScriptRoot 'frame-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $chrome -ArgumentList @(
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  (Quote-Arg "--user-data-dir=$profile"),
  '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=5000',
  '--dump-dom',
  $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Chrome exited with code $($process.ExitCode)." }
$dom = Get-Content -Raw -LiteralPath $stdout
if (-not $dom.Contains('"rootCount":2')) { throw 'Frame smoke test did not scan the same origin iframe.' }
if (-not $dom.Contains('"frameFieldFound":true')) { throw 'Frame smoke test did not match fields inside the iframe.' }
if (-not $dom.Contains('"innerSchoolFilled":"测试大学"')) { throw 'Frame smoke test did not fill the iframe text field.' }
if (-not $dom.Contains('"innerDegreeFilled":"硕士"')) { throw 'Frame smoke test did not fill the iframe select.' }
if (-not $dom.Contains('"innerGenderFilled":"男"')) { throw 'Frame smoke test did not fill the iframe radio group.' }
if (-not $dom.Contains('"unmatchedInFrame":true')) { throw 'Frame smoke test did not expose the unmatched iframe field.' }
if (-not $dom.Contains('"outerNameFilled":"测试姓名"')) { throw 'Frame smoke test did not fill the top document field.' }
if (-not $dom.Contains('"submitAttempts":0')) { throw 'Frame smoke test submit invariant failed.' }
Write-Output 'Same origin iframe smoke test passed: fields scanned and filled across frames; submitAttempts=0.'
