<?php
// NoFrame XAMPP / MySQL configuration
$DB_HOST = '127.0.0.1';
$DB_NAME = 'noframe';
$DB_USER = 'root';
$DB_PASS = ''; // Default XAMPP MySQL password is empty. Change this if yours is different.

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
