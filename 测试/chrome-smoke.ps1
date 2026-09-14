# Exercises content.js against a fixture page. The fixture pulls content.js in with a
# <script> tag, so this passes regardless of whether the extension itself is installed.
# Chrome 152 also ignores --load-extension, so the browser here is only a JS engine.
# Use load-smoke.ps1 to check that the manifest actually loads.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$chrome = Get-TestBrowserOrThrow
$fixturePath = Join-Path $PSScriptRoot 'chrome-fixture.html'
$fixture = [Uri]::new($fixturePath).AbsoluteUri
$tempRoot = Join-Path $root '测试\输出'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$profile = Join-Path $tempRoot 'chrome-extension-profile'
$stdout = Join-Path $tempRoot 'chrome-extension-stdout.txt'
$stderr = Join-Path $tempRoot 'chrome-extension-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$process = Start-Process -FilePath $chrome -ArgumentList @(
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  (Quote-Arg "--user-data-dir=$profile"),
  (Quote-Arg "--disable-extensions-except=$root"),
  (Quote-Arg "--load-extension=$root"),
  '--dump-dom',
  $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Chrome exited with code $($process.ExitCode)." }
$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
$expectedState = '"state":{"name":"测试姓名","gender":"男","phone":"13800138000","school":"测试大学","degree":"硕士","studyMode":"全日制","role":"测试工程师","dayMon":true,"dayTue":false,"dayWed":true,"adjust":true,"reject":false,"submitAttempts":0}'
if (-not $dom.Contains($expectedState)) { throw 'Chrome smoke test did not observe the expected fill state.' }
if (-not $dom.Contains('"daysProposal":"周一、周三"')) { throw 'Chrome smoke test did not propose the whole checkbox group.' }
if (-not $dom.Contains('"discoveredNewField":true')) { throw 'Chrome smoke test did not discover the unmatched field.' }
if (-not $dom.Contains('"discoveredNewFieldDraft":1')) { throw 'Chrome smoke test did not collect the confirmed custom draft.' }
if (-not $dom.Contains('"sensitiveDraftBlocked":true')) { throw 'Chrome smoke test did not block the sensitive draft.' }
if (-not $dom.Contains('"learnBefore":{"isNewField":true,"confidence":"none"}')) { throw 'An unknown label should start unmatched.' }
if (-not $dom.Contains('"learnAfter":{"profileKey":"self_evaluation","confidence":"high","proposedValue":"一段评价"}')) { throw 'A learned label was not recognised as high confidence.' }
 $errors = if (Test-Path -LiteralPath $stderr) { Get-Content -Raw -Encoding UTF8 -LiteralPath $stderr } else { '' }
if ($errors -match 'Failed to load extension|Manifest is not valid') { throw "Chrome extension load failed: $errors" }
Write-Output 'Content script smoke test passed: text, select, radio, and checkbox controls filled; submitAttempts=0. (Extension packaging is covered by load-smoke.ps1.)'
