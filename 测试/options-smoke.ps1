$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$chrome = Get-TestBrowserOrThrow
$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'options-smoke-profile'
$stdout = Join-Path $tempRoot 'options-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'options-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$fixturePath = Join-Path $PSScriptRoot 'options-fixture.html'
$fixture = [Uri]::new($fixturePath).AbsoluteUri
$process = Start-Process -FilePath $chrome -ArgumentList @('--headless=new','--disable-gpu','--allow-file-access-from-files',(Quote-Arg "--user-data-dir=$profile"),'--virtual-time-budget=1500','--dump-dom',$fixture) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Chrome exited with code $($process.ExitCode)." }
$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
if (-not $dom.Contains('"tabCount":14')) { throw 'Options smoke test did not render all tabs.' }
if (-not $dom.Contains('"hasAdditionalTab":true')) { throw 'The 附加信息 tab did not render.' }
if (-not $dom.Contains('"hasCustomTab":true')) { throw 'Custom fields tab did not render.' }
if (-not $dom.Contains('"hasCustomKey":true')) { throw 'Custom field editor did not render the imported key.' }
if (-not $dom.Contains('"hasSiteMemory":true')) { throw 'Site memory summary did not render.' }
if (-not $dom.Contains('"hasAttachmentTab":false')) { throw 'Attachment tab is still visible.' }
if (-not $dom.Contains('"hasEditorContent":true')) { throw 'Options editor content is blank.' }
if (-not $dom.Contains('"tabsWithoutIcon":[]')) { throw 'A 资料分类 tab rendered no icon glyph.' }
if (-not $dom.Contains('"startDateInputType":"text"')) { throw 'Education start date is not the flexible text input.' }
if (-not $dom.Contains('"monthOnlyPreserved":true')) { throw 'A month-only start date was not preserved in the editor.' }
if (-not $dom.Contains('"dayPrecisionValue":"2024-09-18"')) { throw 'Day precision was not accepted and normalised.' }
if (-not $dom.Contains('"invalidFormatFlagged":true')) { throw 'A malformed date was not flagged.' }
Write-Output 'Options smoke test passed: legacy profile loaded; custom field and site memory rendered; every 资料分类 tab drew its icon; flexible dates accept month and day precision; no attachment tab.'
