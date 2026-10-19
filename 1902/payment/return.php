<?php
$orderId = trim($_GET['order_id'] ?? '');
$back = '../html/index.html#/checkout';
?>
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Return</title>
<style>body{font-family:Arial;background:#f5f7fb;display:grid;place-items:center;min-height:100vh}.box{background:#fff;padding:32px;border-radius:16px;max-width:520px;text-align:center;box-shadow:0 10px 30px #0001}.btn{display:inline-block;background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none}</style></head>
<body><div class="box"><h1>Payment Submitted</h1><p>Your PayHere payment flow has returned to NoFrame.</p><?php if($orderId): ?><p>Order: <b><?=htmlspecialchars($orderId)?></b></p><?php endif; ?><p>For localhost testing, PayHere cannot call the server notification URL. The order status can be verified after the gateway test.</p><a class="btn" href="<?=$back?>">Return to NoFrame</a></div></body></html>
