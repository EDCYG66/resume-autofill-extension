$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$chrome = Get-TestBrowserOrThrow
$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'ats-adapter-dynamic-profile'
$stdout = Join-Path $tempRoot 'ats-adapter-dynamic-stdout.txt'
$stderr = Join-Path $tempRoot 'ats-adapter-dynamic-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$fixture = [Uri]::new((Join-Path $PSScriptRoot 'ats-adapter-dynamic-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $chrome -ArgumentList @(
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=12000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Chrome exited with code $($process.ExitCode)." }
$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
$match = [regex]::Match($dom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The ATS fixture produced no result.' }
$data = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
$problems = @()
if (-not $data.initialWatchStarted) { $problems += 'The initial scan did not start the form watcher.' }
if (-not $data.dynamicWatchDirty) { $problems += 'The DOM insertion did not mark the watcher dirty.' }
if (-not $data.adapterCandidateFound) { $problems += 'The structured ATS field was not found after rescan.' }
if (-not ($data.adapterNames -contains 'structured-ats')) { $problems += 'The structured ATS adapter was not reported.' }
if ($data.duplicateCount -ne 1) { $problems += "The dynamic field appeared $($data.duplicateCount) times." }
if ($data.filledValue -ne '北森测试姓名') { $problems += "The native ATS field contains '$($data.filledValue)'." }
if ($data.roleValue -ne '算法工程师') { $problems += "The ATS dropdown displays '$($data.roleValue)'." }
if (@($data.fillStatuses | Where-Object { $_ -ne 'filled' }).Count -gt 0) { $problems += 'At least one ATS field did not report filled.' }
if ($data.submitAttempts -ne 0) { $problems += 'The ATS fixture was submitted.' }
if ($problems.Count -gt 0) {
  throw (($problems -join ' ') + " Actual result: $($match.Groups[1].Value)")
}
Write-Output "ATS adapter/dynamic smoke test passed: $($data.rescannedCount) fields, adapter=$($data.adapterNames -join ',')."
