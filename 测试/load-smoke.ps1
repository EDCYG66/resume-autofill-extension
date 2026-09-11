# Loads the extension into a real browser and checks that it registers with the pinned ID.
#
# This covers what the other smoke tests cannot: chrome-smoke.ps1 calls content.js directly
# from a fixture, so it would pass even if the manifest were invalid or the extension never
# loaded.
#
# Recent Chromium builds (Chrome 137 and later) ignore --load-extension, so this needs a build
# that still honours it. Point $env:RESUME_TEST_BROWSER at one, or the test reports a skip.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

# Hard-coded on purpose: if the manifest key is dropped or swapped, the browser falls back
# to a path-derived ID and this test fails instead of silently orphaning the stored data.
$expectedId = 'peinhogkoplbbmiloaheefjoamoclmgm'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'manifest.json') | ConvertFrom-Json
if (-not $manifest.key) { throw 'manifest.json has no key; the ID would follow the folder path.' }
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = $sha.ComputeHash([System.Convert]::FromBase64String($manifest.key)) } finally { $sha.Dispose() }
$declaredId = -join (0..15 | ForEach-Object { [char](97 + ($hash[$_] -shr 4)); [char](97 + ($hash[$_] -band 15)) })
if ($declaredId -ne $expectedId) { throw "Manifest key now yields $declaredId, expected $expectedId." }

$tempRoot = Join-Path $root '测试\输出'
$work = Join-Path $tempRoot 'load-smoke'
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
$extDir = Join-Path $work 'ext'
$profile = Join-Path $work 'profile'
New-Item -ItemType Directory -Force -Path $extDir | Out-Null

foreach ($name in @('manifest.json','popup.html','popup.js','popup.css','options.html','options.js','options.css','tokens.css','content.js','profile-parser.js')) {
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination $extDir
}
Copy-Item -LiteralPath (Join-Path $root 'icons') -Destination $extDir -Recurse

$stdout = Join-Path $work 'load-smoke-stdout.txt'
$stderr = Join-Path $work 'load-smoke-stderr.txt'
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), (Quote-Arg "--load-extension=$extDir"),
  '--virtual-time-budget=3000', '--dump-dom', 'about:blank'
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

$browserLog = if (Test-Path -LiteralPath $stderr) { Get-Content -Raw -LiteralPath $stderr } else { '' }
# A build that still honours the flag rejects a bad manifest loudly. Silence means the flag was
# simply ignored, which is the case from Chrome 137 on, so the check cannot run at all.
$loadFailed = $browserLog -match 'Failed to load extension|Manifest is not valid|Manifest file is missing'
$prefPath = Join-Path $profile 'Default\Secure Preferences'
if (-not (Test-Path -LiteralPath $prefPath)) {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  Write-Warning "SKIPPED: $browser wrote no profile, so it ignores --load-extension (Chrome 137 and later do). Put a Chromium build that still honours it in tests/browser.local.txt, or set `$env:RESUME_TEST_BROWSER, to run this check."
  exit 0
}
$pref = Get-Content -Raw -LiteralPath $prefPath | ConvertFrom-Json
$settings = $pref.extensions.settings
$loaded = @($settings.PSObject.Properties | Where-Object { $_.Value.location -eq 8 })
if ($loaded.Count -eq 0) {
  if ($loadFailed) { throw "The browser refused to load the extension: $($browserLog.Trim())" }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  Write-Warning "SKIPPED: $browser registered no unpacked extension and reported no manifest error, so it ignores --load-extension. Put a Chromium build that still honours it in tests/browser.local.txt, or set `$env:RESUME_TEST_BROWSER, to run this check."
  exit 0
}
if ($loaded.Count -ne 1) { throw "Expected exactly one unpacked extension, found $($loaded.Count)." }
$actualId = $loaded[0].Name
if ($actualId -ne $expectedId) {
  throw "Loaded with ID $actualId, expected the pinned $expectedId. The extension data would be lost on update."
}

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "Extension load test passed: loaded from a temporary folder and registered as $expectedId (ID pinned, storage stays attached across updates)."
