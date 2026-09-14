# Scans a fixture built from the labels a real recruitment application form uses, and checks
# that every column resolves to the right field and gets the right value, with no manual
# assignment. This guards value-level correctness: the wrong field winning a match, or
# 净身高(cm) failing to resolve. The section-scoping mechanism itself is covered by the unit
# test 'keeps a section leaf from inheriting the generic aliases of its key'.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'appform-smoke-profile'
$stdout = Join-Path $tempRoot 'appform-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'appform-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$fixture = [Uri]::new((Join-Path $PSScriptRoot 'appform-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--virtual-time-budget=10000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
$match = [regex]::Match($dom, '<pre id="result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The application form fixture produced no result.' }
$data = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json

# Every column must be recognised, and none may be left for manual assignment.
$unmatched = @($data.cells | Where-Object { $_.conf -eq 'none' -or $_.isNew })
if ($unmatched.Count -gt 0) {
  throw "Unrecognised columns: $((@($unmatched | ForEach-Object { $_.label })) -join ', ')"
}
$fuzzy = @($data.cells | Where-Object { $_.conf -eq 'medium' })
if ($fuzzy.Count -gt 0) {
  throw "Columns needing confirmation: $((@($fuzzy | ForEach-Object { $_.label })) -join ', ')"
}

# Each column must land on its own field: a section leaf inheriting generic aliases showed up
# here as 荣誉名称 and 项目名称 both resolving to basic.name.
$expected = @{
  '面试站点' = 'intention.interview_site'; '姓名' = 'basic.name'; '出生日期' = 'basic.birth_date'
  '手机号' = 'basic.phone'; 'QQ' = 'basic.qq'; '净身高(cm)' = 'basic.height'
  '体重(kg)' = 'basic.weight'; '紧急联系人' = 'basic.emergency_contact'
  '毕业学校' = 'education.1.school'; '专业名称' = 'education.1.major'
  '第二专业' = 'education.1.second_major'; '兴趣爱好' = 'additional.hobbies'
  '特长' = 'additional.specialty'; '荣誉名称' = 'honors.1.name'; '项目名称' = 'projects.1.name'
}
foreach ($cell in $data.cells) {
  if (-not $expected.ContainsKey($cell.label)) { throw "Unexpected column: $($cell.label)" }
  if ($cell.key -ne $expected[$cell.label]) {
    throw "$($cell.label) resolved to $($cell.key), expected $($expected[$cell.label])"
  }
}

# The values must actually land in the page.
$state = $data.state
if ($state.name -ne '示例姓名') { throw "姓名 was not filled: '$($state.name)'" }
if ($state.height -ne '178') { throw "净身高(cm) was not filled: '$($state.height)'" }
if ($state.weight -ne '75') { throw "体重(kg) was not filled: '$($state.weight)'" }
if ($state.honor -ne '国家励志奖学金一等奖') { throw "荣誉名称 got the wrong value: '$($state.honor)'" }
if ($state.project -ne '多智能体编队通信') { throw "项目名称 got the wrong value: '$($state.project)'" }
if ($state.submitAttempts -ne 0) { throw 'The fixture form was submitted.' }

Write-Output "Application form smoke test passed: $($data.cells.Count) columns all resolved to the right field and filled; submitAttempts=0."
