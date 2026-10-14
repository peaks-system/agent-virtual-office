param(
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function ColorFromHex([string]$Hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}
function Font([float]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular) {
  return [System.Drawing.Font]::new('Yu Gothic UI', $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
}
function DrawCenteredText($Graphics, [string]$Text, $Font, $Brush, [float]$Y, [float]$Width, [float]$Height) {
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $Graphics.DrawString($Text, $Font, $Brush, [System.Drawing.RectangleF]::new(90, $Y, $Width - 180, $Height), $format)
  $format.Dispose()
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$palette = $manifest.background.palette
$cards = @{}
foreach ($card in $manifest.product_cards) { $cards[[string]$card.pick_number] = $card }
$index = 0
foreach ($scene in $manifest.timeline) {
  $index += 1
  $bitmap = [System.Drawing.Bitmap]::new(1080, 1920, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect = [System.Drawing.Rectangle]::new(0, 0, 1080, 1920)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, (ColorFromHex $palette[0]), (ColorFromHex $palette[1]), [float]$manifest.background.gradient_angle)
  $graphics.FillRectangle($gradient, $rect)
  $seed = [int]([Convert]::ToUInt32(([string]$manifest.background.seed).Substring(0, 8), 16) % [int]::MaxValue)
  $random = [System.Random]::new($seed + $index)
  $shapeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 255, 255, 255))
  for ($s = 0; $s -lt 3; $s++) {
    $size = 180 + $random.Next(220)
    $graphics.FillEllipse($shapeBrush, $random.Next(-80, 900), $random.Next(-80, 1700), $size, $size)
  }
  $particleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 255, 255, 255))
  for ($p = 0; $p -lt 10; $p++) {
    $size = 8 + $random.Next(18)
    $graphics.FillEllipse($particleBrush, $random.Next(20, 1040), $random.Next(20, 1880), $size, $size)
  }
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(225, 235, 242))
  if ($scene.kind -eq 'product_card') {
    $card = $cards[[string]$scene.pick_number]
    $panel = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
    $graphics.FillRectangle($panel, 70, 150, 940, 1620)
    $image = [System.Drawing.Image]::FromFile([string]$card.local_asset_path)
    try {
      $box = [System.Drawing.Rectangle]::new(140, 260, 800, 900)
      $ratio = [Math]::Min($box.Width / $image.Width, $box.Height / $image.Height)
      $w = [int]($image.Width * $ratio); $h = [int]($image.Height * $ratio)
      $graphics.DrawImage($image, [int](540 - $w / 2), [int](710 - $h / 2), $w, $h)
    } finally { $image.Dispose() }
    $dark = [System.Drawing.SolidBrush]::new((ColorFromHex '#102A43'))
    DrawCenteredText $graphics ("PICK " + $card.pick_number) (Font 44 ([System.Drawing.FontStyle]::Bold)) $dark 110 1080 100
    $displayName = if ($card.display_name) { [string]$card.display_name } else { [string]$card.product_name }
    $factBadge = if ($card.fact_badge) { [string]$card.fact_badge } elseif ($card.on_screen_text) { [string]$card.on_screen_text } else { [string]$card.verified_fact.value }
    DrawCenteredText $graphics $displayName (Font 55 ([System.Drawing.FontStyle]::Bold)) $dark 1190 1080 150
    DrawCenteredText $graphics ([string]$card.short_appeal) (Font 39) $dark 1330 1080 110
    DrawCenteredText $graphics $factBadge (Font 32 ([System.Drawing.FontStyle]::Bold)) $dark 1460 1080 110
    if ($null -ne $card.price) {
      $priceText = ([string]$card.price.currency) + ' ' + ([string]$card.price.amount)
      DrawCenteredText $graphics $priceText (Font 30) $dark 1640 1080 80
    }
    $dark.Dispose(); $panel.Dispose()
  } else {
    DrawCenteredText $graphics ([string]$scene.text) (Font 62 ([System.Drawing.FontStyle]::Bold)) $white 650 1080 520
  }
  $out = Join-Path $OutputDirectory ("scene-{0:D2}.png" -f $index)
  $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $muted.Dispose(); $white.Dispose(); $particleBrush.Dispose(); $shapeBrush.Dispose(); $gradient.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
