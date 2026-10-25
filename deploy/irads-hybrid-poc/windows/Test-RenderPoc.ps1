param(
    [Parameter(Mandatory = $true)][Uri]$BaseUrl,
    [switch]$Delivery
)
$ErrorActionPreference = 'Stop'
if ($BaseUrl.Scheme -ne 'https' -or -not $BaseUrl.DnsSafeHost.EndsWith('.onrender.com') -or
    $BaseUrl.AbsolutePath -ne '/' -or $BaseUrl.Query -or $BaseUrl.UserInfo -or
    $BaseUrl.Fragment -or -not $BaseUrl.IsDefaultPort) {
    throw 'Use only the root HTTPS URL of your temporary onrender.com service.'
}
# Prompt rather than placing the token in shell history or a URL.
$SecureToken = Read-Host 'POC_PROBE_TOKEN (hidden)' -AsSecureString
$TokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $Headers = @{ 'X-POC-Token' = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPtr) }
    $Method = if ($Delivery) { 'Post' } else { 'Get' }
    $Result = Invoke-RestMethod -Uri ($BaseUrl.AbsoluteUri.TrimEnd('/') + '/probe') `
        -Method $Method -Headers $Headers -TimeoutSec 180 -MaximumRedirection 0
    $Result | ConvertTo-Json -Depth 8
    foreach ($Check in $Result.checks.PSObject.Properties) {
        if ($Check.Value.status -ne 'ok') { throw ('Failed check: ' + $Check.Name) }
    }
    if ($Delivery -and (-not $Result.checks.kafka.readback -or -not $Result.checks.kafka.windows_consumer)) {
        throw 'Kafka readback / Windows consumer proof is missing.'
    }
} finally {
    if ($Headers) { $Headers.Clear() }
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPtr)
}
