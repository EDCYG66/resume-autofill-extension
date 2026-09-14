$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$chrome = Get-TestBrowserOrThrow
$tempRoot = Join-Path $root '测试\输出'; $profile = Join-Path $tempRoot 'dynamic-smoke-profile'; $stdout = Join-Path $tempRoot 'dynamic-smoke-stdout.txt'; $stderr = Join-Path $tempRoot 'dynamic-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$fixture = [Uri]::new((Join-Path $PSScriptRoot 'dynamic-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $chrome -ArgumentList @('--headless=new','--disable-gpu','--allow-file-access-from-files',(Quote-Arg "--user-data-dir=$profile"),'--run-all-compositor-stages-before-draw','--virtual-time-budget=12000','--dump-dom',$fixture) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Chrome exited with code $($process.ExitCode)." }
$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
if (-not $dom.Contains('"evaluation":"测试自我评价文本"')) { throw 'The dynamic fixture self-evaluation did not fill.' }
if (-not $dom.Contains('"marital":"未婚"')) { throw 'The 国聘-style custom select did not fill.' }
if (-not $dom.Contains('"gender":"男"')) { throw 'The name-less 性别 radio group did not fill.' }
if (-not $dom.Contains('"children":"无"')) { throw 'The 有无子女 radio group did not fill its second option.' }
if (-not $dom.Contains('"grad":"2027-06-15"')) { throw 'The date picker was not committed through the calendar panel.' }
if ($dom.Contains('"status":"failed"')) { throw 'A dynamic fixture control reported a failed fill.' }
if (-not $dom.Contains('"isNew":true')) { throw 'The dynamic fixture did not expose an unmatched field.' }
if (-not $dom.Contains('"submitAttempts":0')) { throw 'The dynamic fixture submit invariant failed.' }
Write-Output 'Dynamic form smoke test passed.'
