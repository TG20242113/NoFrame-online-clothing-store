<?php
require_once __DIR__ . '/config.php';

function clean(string $value): string {
    return trim(preg_replace('/[\r\n]+/', ' ', $value));
}

$orderId = clean($_POST['order_id'] ?? '');
$items   = clean($_POST['items'] ?? 'NoFrame Clothing Order');
$amount  = (float)($_POST['amount'] ?? 0);
$name    = clean($_POST['full_name'] ?? '');
$email   = clean($_POST['email'] ?? '');
$phone   = clean($_POST['phone'] ?? '');
$address = clean($_POST['address'] ?? '');
$city    = clean($_POST['city'] ?? '');
$zip     = clean($_POST['zip'] ?? '');
$country = clean($_POST['country'] ?? 'Sri Lanka');
$custom1 = clean($_POST['custom_1'] ?? 'guest');

if (!$orderId || !$name || !$email || !$phone || !$address || !$city || $amount <= 0) {
    http_response_code(400);
    echo '<h2>Payment request is incomplete</h2><p>Please return to checkout and complete your customer details.</p>';
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo '<h2>Invalid email address</h2><p>Please return to checkout and enter a valid email.</p>';
    exit;
}

if (PAYHERE_MERCHANT_SECRET === 'PASTE_YOUR_CURRENT_LOCALHOST_MERCHANT_SECRET_HERE') {
    http_response_code(500);
    echo '<h2>PayHere is not configured yet</h2><p>Open <code>payment/config.php</code> and paste the Merchant Secret for the registered localhost integration.</p>';
    exit;
}

$amountFormatted = number_format($amount, 2, '.', '');
$hash = payhere_hash($orderId, $amount);
$base = payhere_base_url();

$returnUrl = $base . '/payment/return.php?order_id=' . rawurlencode($orderId);
$cancelUrl = $base . '/payment/cancel.php?order_id=' . rawurlencode($orderId);
$notifyUrl = $base . '/payment/notify.php';

// IMPORTANT: Do NOT send payment_method here.
// Leaving it out makes PayHere show its normal "Pay with" screen like the
// interface in the provided reference image. The customer can then choose
// Bank Card and continue to the Visa/Mastercard/AMEX card form.
$fields = [
    'merchant_id' => PAYHERE_MERCHANT_ID,
    'return_url' => $returnUrl,
    'cancel_url' => $cancelUrl,
    'notify_url' => $notifyUrl,
    'first_name' => preg_split('/\s+/', $name)[0],
    'last_name'  => trim(preg_replace('/^\S+\s*/', '', $name)) ?: preg_split('/\s+/', $name)[0],
    'email'      => $email,
    'phone'      => $phone,
    'address'    => $address,
    'city'       => $city,
    'country'    => $country ?: 'Sri Lanka',
    'order_id'   => $orderId,
    'items'      => $items,
    'currency'   => PAYHERE_CURRENCY,
    'amount'     => $amountFormatted,
    'custom_1'   => $custom1,
    'custom_2'   => $zip,
    'hash'       => $hash
];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecting to PayHere</title>
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f1f5f9;display:grid;place-items:center;min-height:100vh;color:#172033}
.box{background:#fff;border-radius:16px;padding:32px;max-width:420px;width:calc(100% - 40px);box-shadow:0 12px 40px rgba(0,0,0,.12);text-align:center}
.spinner{width:34px;height:34px;border:4px solid #e5e7eb;border-top-color:#2f49db;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 18px}@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="box"><div class="spinner"></div><h2>Secure Payment</h2><p>Connecting you to PayHere Sandbox…</p></div>
<form id="payhereForm" method="post" action="<?= htmlspecialchars(PAYHERE_ACTION, ENT_QUOTES) ?>">
<?php foreach ($fields as $key => $value): ?>
<input type="hidden" name="<?= htmlspecialchars($key, ENT_QUOTES) ?>" value="<?= htmlspecialchars((string)$value, ENT_QUOTES) ?>">
<?php endforeach; ?>
</form>
<script>document.getElementById('payhereForm').submit();</script>
</body>
</html>
