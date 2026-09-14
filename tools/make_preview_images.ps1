# Generates the interface preview images used by README.md.
#
# The images have to come from the real popup.html and options.html: a hand-written stand-in would
# keep showing a UI that has already moved on. Both pages talk to chrome.* APIs, which only exist
# inside an extension, so this script injects a small stand-in before their own scripts run and
# screenshots the result with headless Chromium.
#
# The profile and the field list it feeds the pages are synthetic (示例姓名 / 示例大学), so a preview
# can never leak the applicant's real data into the repository.
#
# Run:  .\tools\make_preview_images.ps1     then commit docs/*.png
param(
  # Pixel density of the capture: 2 keeps the images crisp on HiDPI screens.
  [int]$Scale = 2,
  # Browser to use. Resolved through 测试/browser.ps1 when not given.
  [string]$Browser,
  # Height of the options page capture.
  [int]$OptionsHeight = 860,
  # Keep the generated preview pages (useful when a capture comes out wrong).
  [switch]$KeepPages
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root '测试\browser.ps1')
$exe = if ($Browser) { $Browser } else { Get-TestBrowserOrThrow }

$version = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'manifest.json') | ConvertFrom-Json).version
$outDir = Join-Path $root 'docs'
# Kept inside the repository on purpose: no spaces in the path, so nothing has to be quoted.
$workDir = Join-Path $root '测试\输出\preview'
$profileDir = Join-Path $workDir 'chrome-profile'

foreach ($dir in @($outDir, $workDir)) {
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

# What the popup is shown while reviewing. Deliberately a mix of every badge it can draw: exact
# matches, one fuzzy match that needs confirming, one field the profile cannot answer, and the
# sensitive ones that must stay unticked.
$candidates = @(
  [ordered]@{ id = 'preview-1'; label = '姓名'; profileKey = 'basic.name'; proposedValue = '示例姓名'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'input'; fingerprint = 'text:name'; siteKey = 'https://example.com'; name = 'name' },
  [ordered]@{ id = 'preview-2'; label = '性别'; profileKey = 'basic.gender'; proposedValue = '男'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'input'; fingerprint = 'text:gender'; siteKey = 'https://example.com'; name = 'gender' },
  [ordered]@{ id = 'preview-3'; label = '出生日期'; profileKey = 'basic.birth_date'; proposedValue = '2000-01-01'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'input'; fingerprint = 'text:birth'; siteKey = 'https://example.com'; name = 'birthDate'; isDate = $true },
  [ordered]@{ id = 'preview-4'; label = '政治面貌'; profileKey = 'basic.political_status'; proposedValue = '共青团员'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'div'; fingerprint = 'text:political'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-5'; label = '民族'; profileKey = 'basic.ethnicity'; proposedValue = '汉族'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'div'; fingerprint = 'text:ethnicity'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-6'; label = '最高学历'; profileKey = 'education.1.level'; proposedValue = '硕士研究生'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'div'; fingerprint = 'text:level'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-7'; label = '学校名称'; profileKey = 'education.1.school'; proposedValue = '示例大学'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'input'; fingerprint = 'text:school'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-8'; label = '专业'; profileKey = 'education.1.major'; proposedValue = '电子信息工程'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'input'; fingerprint = 'text:major'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-9'; label = '婚姻状况'; profileKey = 'basic.marital_status'; proposedValue = '未婚'; confidence = 'medium'; currentValue = ''; isNewField = $false; sensitive = $false; remember = $false; controlType = 'div'; fingerprint = 'text:marital'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-10'; label = '是否接受岗位调剂'; profileKey = $null; proposedValue = ''; confidence = 'none'; currentValue = ''; isNewField = $true; sensitive = $false; remember = $false; controlType = 'input'; fingerprint = 'text:adjust'; siteKey = 'https://example.com'; name = '' },
  [ordered]@{ id = 'preview-11'; label = '身份证号'; profileKey = 'basic.id_number'; proposedValue = '110101200001010000'; confidence = 'high'; currentValue = ''; isNewField = $false; sensitive = $true; remember = $false; controlType = 'input'; fingerprint = 'text:idnumber'; siteKey = 'https://example.com'; name = 'idNumber' },
  [ordered]@{ id = 'preview-12'; label = '证件照'; profileKey = $null; proposedValue = ''; confidence = 'none'; currentValue = ''; isNewField = $false; sensitive = $true; remember = $false; controlType = 'file'; fingerprint = 'file:photo'; siteKey = 'https://example.com'; name = 'photo' }
)

$previewProfile = [ordered]@{
  basic = [ordered]@{
    name = '示例姓名'; gender = '男'; birth_date = '2000-01-01'; ethnicity = '汉族'
    political_status = '共青团员'; marital_status = '未婚'; native_place = '吉林-长春-朝阳区'
    place_of_origin = '吉林-长春-朝阳区'; current_residence = '吉林-长春-南关区'
    phone = '13800000000'; email = 'example@example.com'; height = '178'; weight = '75'
    id_number = '110101200001010000'
  }
  intention = [ordered]@{ target_role = '电子工程师'; city = '长春市'; salary = '面议' }
  additional = [ordered]@{ hobbies = '摄影、长跑'; specialty = 'Matlab 与 Python' }
  education = @([ordered]@{ school = '示例大学'; college = '示例学院'; major = '电子信息工程'; level = '硕士'; start_date = '2024-09'; end_date = '2027-06'; study_mode = '全日制'; english_level = '大学英语六级(CET-6)' })
  self_evaluation = '习惯把问题拆开逐条核对，做过校级创新项目并担任组长。'
}

# Single-quoted here-strings: the JavaScript below must reach the page with its $ and quotes intact.
$mockTemplate = @'
  <script>
    var PREVIEW_CANDIDATES = __CANDIDATES__;
    var PREVIEW_PROFILE = __PROFILE__;
    window.__saved = null;
    window.__filled = null;
    window.chrome = {
      runtime: { lastError: null, getManifest: function () { return { version: '__VERSION__' }; }, openOptionsPage: function () {} },
      storage: { local: {
        get: function (defaults, callback) { callback({ resumeProfile: PREVIEW_PROFILE, resumeAccent: '#0078d4', resumeLastScan: null }); },
        set: function (value, callback) { window.__saved = value; if (callback) callback(); }
      } },
      tabs: {
        query: function (query, callback) { callback([{ id: 1, url: 'https://example.com/apply' }]); },
        sendMessage: function (tabId, message, callback) {
          if (message.type === 'ping') return callback({ version: '__VERSION__' });
          if (message.type === 'scan') return callback({ candidates: PREVIEW_CANDIDATES });
          if (message.type === 'fill') { window.__filled = message.fields; return callback({ results: [] }); }
          callback({ results: [] });
        }
      },
      scripting: { executeScript: function (options, callback) { if (callback) callback(); } }
    };
  </script>
'@

$mock = $mockTemplate.Replace('__CANDIDATES__', ($candidates | ConvertTo-Json -Depth 6 -Compress))
$mock = $mock.Replace('__PROFILE__', ($previewProfile | ConvertTo-Json -Depth 6 -Compress))
$mock = $mock.Replace('__VERSION__', $version)

# The popup is left on the review list: one scan, then nothing else.
$popupReviewDriver = @'
  <script>
    setTimeout(function () { document.getElementById('scanPage').click(); }, 150);
  </script>
'@
# The other tab of the same popup, showing the lookup list.
$popupQuickCopyDriver = @'
  <script>
    setTimeout(function () {
      document.getElementById('scanPage').click();
      document.getElementById('tabNavQuickCopy').click();
    }, 150);
  </script>
'@

 # The preview pages sit below the repository root, so every asset path has to climb back up. The
 # climb is measured from the real folder instead of being written out by hand: getting it wrong
 # once already produced two screenshots that were silently just the static markup, with every
 # stylesheet and script failing to load.
 $levelsUp = $workDir.Substring($root.Length).Trim('\').Split('\').Count
 $prefix = ('../' * $levelsUp)
 
 function New-PreviewPage {
   param([string]$Source, [string]$Target, [string[]]$Assets, [string]$Driver)
   $path = Join-Path $root $Source
   $html = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
   foreach ($asset in $Assets) {
     # The rewritten path has to land on a real file, or the preview renders without its styling and
     # without its behaviour, which looks like a plausible screenshot and is completely wrong.
     $assetPath = Join-Path $root $asset
     if (-not (Test-Path -LiteralPath $assetPath)) { throw "Missing asset in the repository: $asset" }
     $before = '"' + $asset + '"'
     $after = '"' + $prefix + $asset + '"'
     if (-not $html.Contains($before)) { throw "$Source does not reference $asset; the preview would load nothing." }
     $html = $html.Replace($before, $after)
   }
   # The stand-in has to be defined before the page's first script runs.
   $firstScript = '  <script src="' + $prefix + 'profile-parser.js"></script>'
   if (-not $html.Contains($firstScript)) { throw "$Source no longer loads profile-parser.js first; update this script." }
   $html = $html.Replace($firstScript, $mock + $firstScript)
   $html = $html.Replace('</body>', $Driver + '</body>')
   $targetPath = Join-Path $workDir $Target
   [System.IO.File]::WriteAllText($targetPath, $html, (New-Object System.Text.UTF8Encoding($false)))
   return $targetPath
 }

function Save-Screenshot {
  param([string]$PagePath, [string]$Png, [int]$Width, [int]$Height, [int]$Budget = 8000)
  if (Test-Path -LiteralPath $Png) { Remove-Item -LiteralPath $Png -Force }
  $uri = [Uri]::new($PagePath).AbsoluteUri
  # Chromium reports "N bytes written to file" on stderr. Windows PowerShell 5.1 turns a native
  # command's redirected stderr into error records, which $ErrorActionPreference='Stop' then
  # aborts the script over — a successful capture looked like a failure. The capture is verified
  # by the file check below, so let stderr be noisy for the duration of the call.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $exe '--headless=new' '--disable-gpu' '--no-first-run' '--allow-file-access-from-files' `
      "--user-data-dir=$profileDir" "--window-size=$Width,$Height" `
      "--force-device-scale-factor=$Scale" "--virtual-time-budget=$Budget" `
      "--screenshot=$Png" $uri 2>&1 | Out-Null
  } finally { $ErrorActionPreference = $previous }
  if (-not (Test-Path -LiteralPath $Png)) { throw "No screenshot was written for $PagePath" }
  $size = [Math]::Round((Get-Item -LiteralPath $Png).Length / 1KB)
  Write-Output ("wrote {0} ({1} KB, {2}x{3} css px at {4}x)" -f (Split-Path -Leaf $Png), $size, $Width, $Height, $Scale)
}
 
 # A page whose stylesheets and scripts failed to load still photographs into something that looks
 # like a plausible screenshot, so each capture is checked for markup only the page's own
 # JavaScript can produce.
 function Assert-Rendered {
   param([string]$PagePath, [string]$Pattern, [string]$What)
   $uri = [Uri]::new($PagePath).AbsoluteUri
   # Same stderr caveat as Save-Screenshot: the dump either matches or the throw below fires.
   $previous = $ErrorActionPreference
   $ErrorActionPreference = 'Continue'
   try {
     $dom = & $exe '--headless=new' '--disable-gpu' '--no-first-run' '--allow-file-access-from-files' `
       "--user-data-dir=$profileDir" '--virtual-time-budget=8000' '--dump-dom' $uri 2>&1 | Out-String
   } finally { $ErrorActionPreference = $previous }
   if ($dom -notmatch $Pattern) {
     throw "The preview page rendered no $What, so the screenshot would only show static markup."
   }
   Write-Output ("checked: {0} is present" -f $What)
 }

$popupAssets = @('tokens.css', 'popup.css', 'profile-parser.js', 'shared.js', 'popup.js')
$optionsAssets = @('tokens.css', 'options.css', 'profile-parser.js', 'shared.js', 'options.js')

$reviewPage = New-PreviewPage -Source 'popup.html' -Target 'preview-popup-review.html' -Assets $popupAssets -Driver $popupReviewDriver
$quickPage = New-PreviewPage -Source 'popup.html' -Target 'preview-popup-quick-copy.html' -Assets $popupAssets -Driver $popupQuickCopyDriver
$optionsPage = New-PreviewPage -Source 'options.html' -Target 'preview-options.html' -Assets $optionsAssets -Driver ''

 
 Assert-Rendered -PagePath $reviewPage -Pattern 'class="candidate' -What 'the review list'
 Assert-Rendered -PagePath $quickPage -Pattern 'class="copy-card' -What 'the lookup cards'
 Assert-Rendered -PagePath $optionsPage -Pattern 'class="nav-item' -What 'the editor navigation'
Save-Screenshot -PagePath $reviewPage -Png (Join-Path $outDir 'popup-review.png') -Width 420 -Height 620
Save-Screenshot -PagePath $quickPage -Png (Join-Path $outDir 'popup-quick-copy.png') -Width 420 -Height 620
Save-Screenshot -PagePath $optionsPage -Png (Join-Path $outDir 'options-editor.png') -Width 1280 -Height $OptionsHeight

 if (-not $KeepPages) { Remove-Item -LiteralPath $reviewPage, $quickPage, $optionsPage -Force }
if (Test-Path -LiteralPath $profileDir) { Remove-Item -LiteralPath $profileDir -Recurse -Force }
Write-Output 'README preview images are in docs/ — commit them with the README change.'
