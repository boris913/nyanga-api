# Enregistre les secrets Chariow dans SSM (/nyanga/prod/*) sans les afficher,
# puis copie PROXY_SECRET dans le presse-papiers pour la variable d'environnement Vercel.
# Usage : powershell -ExecutionPolicy Bypass -File infra\aws\set-secrets.ps1
param(
  [string]$AwsProfile = "nyanga",
  [string]$Region = "eu-west-3"
)
$ErrorActionPreference = "Stop"

function Read-Secret([string]$Label) {
  $secure = Read-Host -Prompt $Label -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Save-Secret([string]$Name, [string]$Value) {
  if (-not $Value) { Write-Host "  $Name : vide, ignoré"; return }
  # Passage par un fichier JSON temporaire : aucun souci de guillemets ou de caractères spéciaux.
  $tmp = [IO.Path]::GetTempFileName()
  try {
    @{ Name = "/nyanga/prod/$Name"; Type = "SecureString"; Value = $Value; Overwrite = $true } |
      ConvertTo-Json | Set-Content -Path $tmp -Encoding ASCII
    aws ssm put-parameter --profile $AwsProfile --region $Region --cli-input-json "file://$tmp" --query Version --output text | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Échec de l'enregistrement de $Name" }
    Write-Host "  $Name enregistré"
  } finally { Remove-Item $tmp -Force }
}

Write-Host "Compte AWS utilisé :" (aws sts get-caller-identity --profile $AwsProfile --query Account --output text)
Write-Host "Collez chaque valeur puis Entrée (rien ne s'affiche, c'est normal). Entrée seule pour passer."
Save-Secret "CHARIOW_API_KEY" (Read-Secret "Clé API Chariow")
Save-Secret "CHARIOW_PULSE_SECRET" (Read-Secret "Secret de signature Pulse Chariow")

$proxy = aws ssm get-parameter --profile $AwsProfile --region $Region --name /nyanga/prod/PROXY_SECRET --with-decryption --query Parameter.Value --output text
Set-Clipboard -Value $proxy
Write-Host ""
Write-Host "PROXY_SECRET est copié dans le presse-papiers."
Write-Host "Vercel : Settings > Environment Variables > Add : nom PROXY_SECRET, valeur Ctrl+V, puis Redeploy."
