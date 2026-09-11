# Proves the thing people actually download works: runs tools/pack.ps1, extracts the zip the
# way a user would, and loads the extracted folder into a real browser.
#
# This is the only test that checks the delivery format end to end. The other smoke tests build
# their own copy of the files, so they would still pass if the zip were missing the icons, sent
# manifest.json down a level, or dragged the template and the tests along with it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$expectedId = 'peinhogkoplbbmiloaheefjoamoclmgm'
$zipPath = Join-Path $root '简历填充助手.zip'

# Always rebuild, so the test never blesses a stale archive.
& (Join-Path $root 'tools\pack.ps1') | ForEach-Object { Write-Verbose $_ }
if (-not (Test-Path -LiteralPath $zipPath)) { throw 'tools/pack.ps1 produced no zip.' }

$work = Join-Path $root '测试\输出\pack-smoke'
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
$extDir = Join-Path $work '解压后的扩展'
$profile = Join-Path $work 'profile'
New-Item -ItemType Directory -Force -Path $extDir | Out-Null

Expand-Archive -LiteralPath $zipPath -DestinationPath $extDir -Force

# Extracting has to yield a folder Chrome accepts directly: manifest.json at the top level,
# with the icons and every script it references next to it.
if (-not (Test-Path -LiteralPath (Join-Path $extDir 'manifest.json'))) {
  throw 'The extracted folder has no manifest.json at its root, so it cannot be loaded unpacked.'
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $extDir 'manifest.json') | ConvertFrom-Json
foreach ($name in @('popup.html','options.html','content.js','profile-parser.js','popup.js','options.js','popup.css','options.css','tokens.css')) {
  if (-not (Test-Path -LiteralPath (Join-Path $extDir $name))) { throw "The zip is missing $name" }
}
foreach ($relative in @($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value })) {
  if (-not (Test-Path -LiteralPath (Join-Path $extDir $relative))) { throw "The zip is missing the icon $relative" }
}
if ($manifest.key -ne (Get-Content -Raw -LiteralPath (Join-Path $root 'manifest.json') | ConvertFrom-Json).key) {
  throw 'The packed manifest lost the pinned key; updates would orphan the stored profile.'
}

# And the delivery format itself has to stay clean: extension only, no personal files and none
# of the repository-only material. Paths are matched relative to the extracted folder, because
# this test's own working directory lives under 测试/ as well.
$strayFiles = @(Get-ChildItem -LiteralPath $extDir -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($extDir.Length + 1)
  if ($relative -match '模板文件|resume-profile|personal-values|\.local\.' -or $relative -match '^(测试|tools)[\\/]' -or $_.Extension -eq '.ps1') {
    $relative
  }
})
if ($strayFiles.Count) {
  throw "The zip carried files it should not: $($strayFiles -join ', ')"
}

# Finally, a real browser has to accept it.
$stdout = Join-Path $work 'stdout.txt'
$stderr = Join-Path $work 'stderr.txt'
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), (Quote-Arg "--load-extension=$extDir"),
  '--virtual-time-budget=3000', '--dump-dom', 'about:blank'
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

$browserLog = if (Test-Path -LiteralPath $stderr) { Get-Content -Raw -LiteralPath $stderr } else { '' }
if ($browserLog -match 'Failed to load extension|Manifest is not valid|Manifest file is missing') {
  throw "The browser refused the packed extension: $($browserLog.Trim())"
}

$prefPath = Join-Path $profile 'Default\Secure Preferences'
if (-not (Test-Path -LiteralPath $prefPath)) {
  Write-Warning "SKIPPED the browser load half: $browser ignores --load-extension (Chrome 137 and later do). The structure checks above still ran. Put a Chromium build that still honours it in 测试/browser.local.txt, or set `$env:RESUME_TEST_BROWSER."
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
}
$pref = Get-Content -Raw -LiteralPath $prefPath | ConvertFrom-Json
$loaded = @($pref.extensions.settings.PSObject.Properties | Where-Object { $_.Value.location -eq 8 })
if ($loaded.Count -eq 0) {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  Write-Warning "SKIPPED the browser load half: $browser registered no unpacked extension and reported no manifest error, so it ignores --load-extension. The structure checks above still ran."
  exit 0
}
if ($loaded.Count -ne 1) { throw "Expected exactly one unpacked extension, found $($loaded.Count)." }
$actualId = $loaded[0].Name
if ($actualId -ne $expectedId) {
  throw "The packed extension loaded as $actualId, expected the pinned $expectedId. Updating would orphan the stored profile."
}

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "Package smoke test passed: the zip extracts to a loadable extension folder and registers as $expectedId, so 加载已解压的扩展程序 works and updates keep the profile."
