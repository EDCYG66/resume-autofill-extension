# Builds 简历填充助手.zip, which contains the extension alone.
#
# The zip is meant to be handed over as-is: extract it and the extracted folder is directly
# loadable through chrome://extensions -> 加载已解压的扩展程序, because manifest.json sits at
# the root of the archive. To update an existing install, extract the new zip over the same
# folder and press 重新加载; the pinned manifest key keeps the stored profile attached.
#
# Deliberately NOT included: the blank template (模板文件.txt ships beside the zip as its own
# file), the tests, the build helpers and anything personal. The checks at the end enforce that.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root '测试\输出\pack'
$zipPath = Join-Path $root '简历填充助手.zip'

$files = @(
  'manifest.json','popup.html','popup.js','popup.css','options.html','options.js','options.css',
  'tokens.css','content.js','profile-parser.js','README.md','LICENSE'
)
$directories = @('icons')

foreach ($name in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $name))) { throw "Missing file: $name" }
}
foreach ($name in $directories) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $name))) { throw "Missing directory: $name" }
}

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage }
foreach ($name in $directories) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage -Recurse }

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName })

  # The archive has to be loadable as-is once extracted.
  if (-not ($entries | Where-Object { $_ -eq 'manifest.json' })) {
    throw 'manifest.json is not at the root of the zip, so the extracted folder would not load.'
  }
  if (-not ($entries | Where-Object { $_ -like 'icons/*' })) { throw 'The icons are missing from the zip.' }

  # The zip is shared with other people, so it must stay free of personal data and of files
  # that only make sense inside the repository.
  $personalFile = Join-Path $root 'personal-values.local.txt'
  if (Test-Path -LiteralPath $personalFile) {
    $personalValues = @(Get-Content -LiteralPath $personalFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_[0] -ne '#' })
    foreach ($entry in $archive.Entries) {
      if ($entry.Length -eq 0) { continue }
      $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
      try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
      foreach ($secret in $personalValues) {
        if ($text.Contains($secret)) { throw "The zip contains a personal value ($secret) in $($entry.FullName)" }
      }
    }
  } else {
    Write-Warning 'personal-values.local.txt is missing; the personal value scan is skipped.'
  }
  $forbidden = @($entries | Where-Object { $_ -match '模板文件|测试/|tools/|resume-profile|personal-values|\.local\.|\.ps1$' })
  if ($forbidden.Count) { throw "The zip carries files it should not: $($forbidden -join ', ')" }

  $kilobytes = [Math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB)
  Write-Output "Packaged $($entries.Count) entries into 简历填充助手.zip ($kilobytes KB)"
} finally { $archive.Dispose() }

Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output '解压后得到的就是扩展文件夹，可直接用 chrome://extensions -> 加载已解压的扩展程序 加载。'
Write-Output '更新时解压到同一个文件夹并点“重新加载”，资料不会丢（manifest 里的 key 固定了扩展 ID）。'
