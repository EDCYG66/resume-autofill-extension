# Shared helper for the smoke tests: locate a Chromium-based browser.
#
# Nobody has Chrome in the same place, so the tests never hard-code one path. Override with
# $env:RESUME_TEST_BROWSER when your browser lives somewhere unusual or you want a specific
# build (for example an older Chromium that still honours --load-extension).
#
# Dot-source this file, then call Get-TestBrowserOrThrow.

function Join-IfSet {
  param([string]$Base, [string]$Child)
  if ($Base) { return [System.IO.Path]::Combine($Base, $Child) }
  return $null
}

# Start-Process joins the argument array with spaces and quotes nothing, so any argument holding
# a path with a space in it gets split in two and the browser dies with exit code 13. A Windows
# user folder such as "C:\Users\Gao Yilong" is enough to trigger it, so quote those arguments.
function Quote-Arg {
  param([string]$Value)
  return '"' + $Value + '"'
}

function Get-TestBrowser {
  param(
    # Extra candidates to try before the built-in list, most-wanted first.
    [string[]]$Extra = @()
  )
  $candidates = @()
  if ($env:RESUME_TEST_BROWSER) { $candidates += $env:RESUME_TEST_BROWSER }
  # Optional machine-local override, git-ignored: the first line that is not blank or a comment.
  # Handy when the newest Chrome ignores --load-extension but an older Chromium build is around.
  $localFile = Join-Path $PSScriptRoot 'browser.local.txt'
  if (Test-Path -LiteralPath $localFile) {
    $localPath = Get-Content -Encoding UTF8 -LiteralPath $localFile |
      Where-Object { $_ -and $_.Trim() -and -not $_.Trim().StartsWith('#') } |
      ForEach-Object { $_.Trim() } |
      Select-Object -First 1
    if ($localPath) { $candidates += $localPath }
  }
  $candidates += $Extra

  $programFiles = $env:ProgramFiles
  $programFilesX86 = ${env:ProgramFiles(x86)}
  $localAppData = $env:LOCALAPPDATA
  $candidates += @(
    (Join-IfSet $programFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-IfSet $programFilesX86 'Google\Chrome\Application\chrome.exe'),
    (Join-IfSet $localAppData 'Google\Chrome\Application\chrome.exe'),
    (Join-IfSet $programFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-IfSet $programFilesX86 'Microsoft\Edge\Application\msedge.exe'),
    (Join-IfSet $programFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
    (Join-IfSet $localAppData 'BraveSoftware\Brave-Browser\Application\brave.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  )

  foreach ($name in @('google-chrome','chromium','chromium-browser','microsoft-edge','brave-browser')) {
    $found = Get-Command $name -ErrorAction SilentlyContinue
    if ($found -and $found.Source) { $candidates += $found.Source }
  }

  return ($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1)
}

function Get-TestBrowserOrThrow {
  param([string[]]$Extra = @())
  $browser = Get-TestBrowser -Extra $Extra
  if (-not $browser) {
    throw 'No Chromium-based browser found. Install Chrome or Edge, or point $env:RESUME_TEST_BROWSER at your chrome.exe.'
  }
  return $browser
}
