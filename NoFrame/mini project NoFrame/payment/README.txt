NOFRAME - PAYHERE SANDBOX PAYMENT
=================================

1. Open payment/config.php.
2. Keep PAYHERE_MERCHANT_ID equal to the Merchant ID in your PayHere Integration row.
3. Replace PASTE_YOUR_CURRENT_LOCALHOST_MERCHANT_SECRET_HERE with the Merchant Secret for the registered localhost row.
4. Do NOT put the Merchant Secret into js/app.js or any HTML file.
5. Start Apache + MySQL in XAMPP.
6. Open the site through http://localhost/.../html/index.html.
7. Login -> add products -> Checkout -> Shipping -> Confirmation -> Payment -> Pay Now.
8. The browser goes to payment/start.php. That server-side file calculates the PayHere hash and automatically POSTs to:
   https://sandbox.payhere.lk/pay/checkout
9. The normal PayHere "Pay with" screen is intentionally preserved because payment_method is NOT sent. The customer can select Bank Card and then enter card details on PayHere's secure page.

SANDBOX TEST CARD
------------------
Visa: 4916217501611292
Name/CVV/Expiry: any valid test values.

IMPORTANT
---------
PayHere itself renders the payment gateway interface. Do not try to copy the PayHere card-number/CVV page into NoFrame. The customer's card details should be entered on PayHere.

LOCALHOST LIMITATION
--------------------
PayHere requires notify_url to be publicly accessible to send server callbacks. localhost cannot receive that callback. The return/cancel pages work for local browser testing, but automatic database status updates require a public URL/tunnel/deployment.
