# Project checks that run on any clone: manifest, icons, shipped files, privacy guardrails.
#
# This script must stay runnable for somebody who has just cloned the repository, so it never
# requires the local resume-profile.txt. Your own profile checks live in
# 测试/verify-local-profile.ps1, which is git-ignored.
#
# Layout it assumes:
#   <root>/             the extension itself (manifest.json sits here, so the folder is
#                       directly loadable through chrome://extensions -> 加载已解压的扩展程序)
#   <root>/模板文件.txt   the blank template that ships separately from the zip
#   <root>/测试/         tests, build helpers and their output
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$required = @(
  'manifest.json','popup.html','popup.js','popup.css','options.html','options.js','options.css',
  'tokens.css','shared.js','content.js','profile-parser.js','README.md','LICENSE','.gitignore','.gitattributes',
  '模板文件.txt',
  'icons/icon.svg','icons/icon-16.png','icons/icon-32.png','icons/icon-48.png','icons/icon-128.png',
  'tools/make_icons.py','tools/make_extension_key.py','tools/make_popup_fixture.py','tools/pack.ps1',
  '测试/browser.ps1','测试/frame-fixture.html','测试/frame-inner.html','测试/frame-smoke.ps1',
  '测试/load-smoke.ps1','测试/popup-fixture.html','测试/popup-smoke.ps1','测试/appform-fixture.html',
  '测试/appform-smoke.ps1','测试/dynamic-fixture.html','测试/dynamic-smoke.ps1','测试/pack-smoke.ps1',
  '测试/shared.test.js','测试/shadow-fixture.html','测试/shadow-smoke.ps1',
  '测试/phoenix-fixture.html','测试/phoenix-smoke.ps1'
)
foreach ($name in $required) {
  $path = Join-Path $root $name
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing required file: $name" }
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'manifest.json') | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'Manifest is not MV3' }
 if ($manifest.version -ne '0.3.3') { throw "Expected release version 0.3.3, found $($manifest.version)" }
$actualPermissions = @($manifest.permissions | Sort-Object)
$expectedPermissions = @('activeTab','scripting','storage')
if (($actualPermissions -join ',') -ne (($expectedPermissions | Sort-Object) -join ',')) { throw "Unexpected permissions: $($actualPermissions -join ',')" }
if ($manifest.host_permissions) { throw 'host_permissions must not be present' }

# A pinned key keeps the extension ID (and therefore its stored data) stable no matter
# which folder it is loaded from. Without it, moving or re-extracting the folder gives a
# new ID, a fresh empty storage area and a second copy in the extensions list.
if (-not $manifest.key) { throw 'Manifest is missing the pinned key; the extension ID would depend on the folder path' }
$keyBytes = [System.Convert]::FromBase64String($manifest.key)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = $sha.ComputeHash($keyBytes) } finally { $sha.Dispose() }
$pinnedId = -join (0..15 | ForEach-Object { [char](97 + ($hash[$_] -shr 4)); [char](97 + ($hash[$_] -band 15)) })
if ($pinnedId -ne 'peinhogkoplbbmiloaheefjoamoclmgm') { throw "Pinned extension ID changed: $pinnedId" }

$declaredIcons = @()
$declaredIcons += @($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value })
$declaredIcons += @($manifest.action.default_icon.PSObject.Properties | ForEach-Object { $_.Value })
if ($declaredIcons.Count -eq 0) { throw 'Manifest declares no icons' }
foreach ($relative in $declaredIcons) {
  $iconPath = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $iconPath)) { throw "Manifest icon is missing: $relative" }
  $expected = [int]([System.IO.Path]::GetFileNameWithoutExtension($relative) -replace '^icon-', '')
  $bitmap = New-Object System.Drawing.Bitmap($iconPath)
  try {
    if ($bitmap.Width -ne $expected -or $bitmap.Height -ne $expected) {
      throw "$relative is $($bitmap.Width)x$($bitmap.Height), expected ${expected}x${expected}"
    }
  } finally { $bitmap.Dispose() }
}

foreach ($page in @('popup.html','options.html')) {
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $page)
  if (-not $text.Contains('href="tokens.css"')) { throw "$page does not link tokens.css" }
}

# The blank template is a deliverable, so it has to stay committed. Your own filled-in copies
# keep the personal file names below and must stay ignored.
$ignore = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root '.gitignore')
foreach ($personalName in @('resume-profile.txt','简历模板信息文件.txt','简历资料导出.txt','personal-values.local.txt')) {
  if (-not $ignore.Contains($personalName)) { throw "The personal file name $personalName is not ignored" }
}
if (Test-Path -LiteralPath (Join-Path $root '.git')) {
  & git -C $root check-ignore --quiet -- '模板文件.txt'
  if ($LASTEXITCODE -eq 0) { throw '模板文件.txt is git-ignored; the template would never reach the repository' }
  & git -C $root check-ignore --quiet -- 'resume-profile.txt'
  if ($LASTEXITCODE -ne 0) { throw 'resume-profile.txt is not ignored; a real profile could be committed' }
}

$templatePath = Join-Path $root '模板文件.txt'
$template = Get-Content -Raw -Encoding UTF8 -LiteralPath $templatePath
if ($template.Contains('[attachments.')) { throw 'Attachment sections must be absent from templates' }
$activeFiles = @('manifest.json','popup.html','popup.js','options.html','options.js','content.js','profile-parser.js','模板文件.txt')
foreach ($file in $activeFiles) {
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $file)
  if ($text -match '附件') { throw "Attachment UI/text found in active file: $file" }
}

# The content script version must come from the manifest, never from a literal.
foreach ($name in @('content.js','popup.js')) {
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $name)
  if ($text -match "CONTENT_VERSION\s*=\s*'") { throw "Hard coded content version in $name" }
  if ($text -match "version\s*===\s*'[0-9]") { throw "Hard coded version comparison in $name" }
}

# The blank template is handed to other people, so it has to parse cleanly, carry no example
# value that could be typed into a real form, and round-trip byte for byte. Filling it in place
# turns any of these into a failure, which is the signal to copy it somewhere else first.
$env:RESUME_EXTENSION_ROOT = $root
 $env:RESUME_TEMPLATE_FILE = $templatePath
$templateCheck = @'
const fs = require('fs');
const path = require('path');
const root = process.env.RESUME_EXTENSION_ROOT;
const parser = require(path.join(root, 'profile-parser.js'));
const content = require(path.join(root, 'content.js'));
 const profile = parser.parse(fs.readFileSync(process.env.RESUME_TEMPLATE_FILE, 'utf8'));
const offered = content.flattenProfile(profile);
if (offered.length) throw new Error('The shipped template offers ' + offered.length + ' values; it must ship blank');
const extras = Object.keys(profile.extras);
if (extras.length) throw new Error('The shipped template leaked unknown keys into extras: ' + extras.join(', '));
['education', 'employment', 'projects', 'honors', 'activities', 'campus_roles', 'skills', 'application_answers'].forEach(function (key) {
  if (profile[key].length) throw new Error('The shipped template created blank ' + key + ' records');
});
const once = parser.stringify(profile);
if (parser.stringify(parser.parse(once)) !== once) throw new Error('Template export is not stable');
console.log('Shipped template verification passed: parses clean, offers no values, round trips.');
'@
$templateCheck | node -
if ($LASTEXITCODE -ne 0) { throw 'Shipped template verification failed' }

# The zip people download must be the extension alone, so nothing personal and no test files
# may be inside it.
$zipPath = Join-Path $root '简历填充助手.zip'
if (Test-Path -LiteralPath $zipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })
    $leaked = @($entries | Where-Object { $_ -match 'resume-profile|personal-values|\.local\.|模板文件|测试/|tools/' })
    if ($leaked.Count) { throw "The zip carries files it should not: $($leaked -join ', ')" }
    if (-not ($entries | Where-Object { $_ -eq 'manifest.json' })) { throw 'The zip is not directly loadable: manifest.json is not at its root' }
  } finally { $archive.Dispose() }
}

# Reverse leak scan: no personal value may appear in a file that would be committed.
# personal-values.local.txt is git-ignored, so the scan is skipped on a fresh clone.
$personalFile = Join-Path $root 'personal-values.local.txt'
if (Test-Path -LiteralPath $personalFile) {
  $personalValues = @(Get-Content -Encoding UTF8 -LiteralPath $personalFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_[0] -ne '#' })
  $textExtensions = @('.js','.html','.css','.json','.md','.txt','.ps1','.py')
  # 身份证正面/反面 scans of the document itself. Bare 身份证 is only the name of a document
  # type and is a legitimate enum value for id_type, so it is not treated as a leak.
  $shippable = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force) |
    Where-Object { $_.FullName -notmatch '\\\.git\\|\\测试\\输出\\|\\node_modules\\' }
  foreach ($file in $shippable) {
    if ($textExtensions -notcontains $file.Extension) { continue }
    # This script names every pattern it scans for, and your own files legitimately hold your
    # data, so neither is a leak. Everything else has to be clean.
    if ($file.Name -in @('verify-extension.ps1','personal-values.local.txt','verify-local-profile.ps1')) { continue }
    if ($file.Name -like 'resume-profile*' -or $file.Name -like '简历模板信息文件*' -or $file.Name -like '简历资料导出*') { continue }
    $relative = $file.FullName.Substring($root.Length + 1)
    $pathspec = $relative -replace '\\','/'
    if (Test-Path -LiteralPath (Join-Path $root '.git')) {
      # Anything git ignores never ships, so it is not a leak. check-ignore exits 1 for a path
      # that is not ignored, so record the answer and clear the code: otherwise the script
      # finishes with $LASTEXITCODE = 1 and callers read a clean run as a failure.
      & git -C $root check-ignore --quiet -- $pathspec
      $isIgnored = ($LASTEXITCODE -eq 0)
      $global:LASTEXITCODE = 0
      if ($isIgnored) { continue }
    }
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
    foreach ($secret in $personalValues + @('身份证正面','身份证反面')) {
      if ($text.Contains($secret)) { throw "Personal value found in ${relative}: $secret" }
    }
  }
  Write-Output 'Personal value scan passed: no personal value appears in a committed file.'
} else {
  Write-Warning 'personal-values.local.txt is missing; the reverse personal value scan is skipped.'
}

Write-Output 'Extension verification passed.'
