<?php
// NoFrame XAMPP / MySQL configuration
$DB_HOST = '127.0.0.1';
$DB_NAME = 'noframe';
$DB_USER = 'root';
$DB_PASS = ''; // Default XAMPP MySQL password is empty. Change this if yours is different.

// Google Sign-In (Google Identity Services) — create an OAuth 2.0 *Web
// application* client ID in Google Cloud Console, restrict it to your origin,
// and paste it here AND in js/app.js (GOOGLE_CLIENT_ID). Leave it empty to
// keep Google sign-up disabled; email sign-up always works.
define('GOOGLE_CLIENT_ID', '');

function db(): PDO {
    global $DB_HOST, $DB_NAME, $DB_USER, $DB_PASS;
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            "mysql:host={$DB_HOST};dbname={$DB_NAME};charset=utf8mb4",
            $DB_USER,
            $DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]
        );
    }
    return $pdo;
}
