<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/jwt.php';

function out($payload, $status=200) {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function arr($value) {
    if ($value === null || $value === '') return [];
    $x = json_decode($value, true);
    return is_array($x) ? $x : [];
}

function bodyJson() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data)) out(['ok'=>false,'message'=>'Invalid JSON body'], 400);
    return $data;
}

function getAuthToken(): ?string {
    if (!empty($_COOKIE['token'])) {
        return $_COOKIE['token'];
    }
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
        return $matches[1];
    }
    return null;
}

function getAuthenticatedUser(PDO $pdo): ?array {
    $token = getAuthToken();
    if (!$token) return null;
    $payload = jwtVerify($token);
    if (!$payload || empty($payload['sub'])) return null;

    $stmt = $pdo->prepare("SELECT u.id, u.name, u.email, u.role, u.created_at, u.password_hash,
                           p.phone, p.shipping_address, p.billing_address, p.avatar, p.account_status
                           FROM users u
                           LEFT JOIN user_profiles p ON u.id = p.user_id
                           WHERE u.id = ?");
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

/* --- SERVER-SIDE RBAC GUARDS (Week 08: hiding a link is not protection) --- */
function requireAuth(PDO $pdo): array {
    $user = getAuthenticatedUser($pdo);
    if (!$user) {
        out(['ok'=>false, 'success'=>false, 'message'=>'Unauthorized session'], 401);
    }
    return $user;
}

function requireAdmin(PDO $pdo): array {
    $user = requireAuth($pdo);
    if (($user['role'] ?? 'customer') !== 'admin') {
        out(['ok'=>false, 'success'=>false, 'message'=>'Access denied — administrator account required'], 403);
    }
    return $user;
}

function hasColumn(PDO $pdo, string $table, string $column): bool {
    static $cache = [];
    $key = $table . '.' . $column;
    if (!array_key_exists($key, $cache)) {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM `{$table}` LIKE ?");
        $stmt->execute([$column]);
        $cache[$key] = (bool)$stmt->fetchColumn();
    }
    return $cache[$key];
}

function validatePasswordComplexity(string $pw): array {
    if (strlen($pw) < 8) {
        return ['valid' => false, 'message' => 'Password must be at least 8 characters long.'];
    }
    if (!preg_match('/[A-Z]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one uppercase letter.'];
    }
    if (!preg_match('/[a-z]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one lowercase letter.'];
    }
    if (!preg_match('/[0-9]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one number.'];
    }
    if (!preg_match('/[@$!%*?&#^()_+\-=\[\]{};\':"\\\\|,.<>\/?]/', $pw)) {
        return ['valid' => false, 'message' => 'Password must contain at least one special character.'];
    }
    return ['valid' => true, 'message' => 'Password meets complexity requirements.'];
}

try {
    $pdo = db();
    $action = $_GET['action'] ?? 'load';

    /* --- AUTHENTICATION ENDPOINTS --- */

    if ($action === 'register') {
        $data = bodyJson();
        $name = trim($data['name'] ?? $data['full_name'] ?? '');
        $email = trim(strtolower($data['email'] ?? ''));
        $password = $data['password'] ?? '';
        $confirmPassword = $data['confirm_password'] ?? $data['confirmPassword'] ?? '';
        $phone = trim($data['phone'] ?? '');

        if (!$name || !$email || !$password) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Please fill in all required fields (Name, Email, Password)'], 400);
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Invalid email address format'], 400);
        }

        $pwCheck = validatePasswordComplexity($password);
        if (!$pwCheck['valid']) {
            out(['ok'=>false, 'success'=>false, 'message'=>$pwCheck['message']], 400);
        }

        if ($password !== $confirmPassword) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Password and confirm password do not match'], 400);
        }

        // Check if user exists (Step 1)
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetchColumn() > 0) {
            out(['ok'=>false, 'success'=>false, 'message'=>'An account with this email address already exists'], 400);
        }

        // Hash password with bcrypt (Step 2)
        $hashedPw = password_hash($password, PASSWORD_BCRYPT);
        $userId = 'U' . uniqid();
        // Self-registration ALWAYS lands as role "customer" (admins are seeded
        // directly in the database) and may carry a first-order discount PIN.
        $discountPin = trim($data['discount_pin'] ?? '');

        // Insert into Users & Profiles (Step 3)
        $pdo->beginTransaction();
        if ($discountPin !== '' && hasColumn($pdo, 'users', 'discount_pin')) {
            $stmt = $pdo->prepare("INSERT INTO users(id, name, email, password_hash, role, discount_pin) VALUES(?, ?, ?, ?, ?, ?)");
            $stmt->execute([$userId, $name, $email, $hashedPw, 'customer', $discountPin]);
        } else {
            $stmt = $pdo->prepare("INSERT INTO users(id, name, email, password_hash, role) VALUES(?, ?, ?, ?, ?)");
            $stmt->execute([$userId, $name, $email, $hashedPw, 'customer']);
        }

        $stmt = $pdo->prepare("INSERT INTO user_profiles(user_id, phone, shipping_address, billing_address, avatar, account_status) VALUES(?, ?, ?, ?, ?, ?)");
        $stmt->execute([$userId, $phone, '', '', '/assets/u1.svg', 'Active Member']);
        $pdo->commit();

        out(['ok'=>true, 'success'=>true, 'message'=>'User registered successfully', 'userId'=>$userId], 201);
    }

    if ($action === 'login') {
        $data = bodyJson();
        $email = trim(strtolower($data['email'] ?? ''));
        $password = $data['password'] ?? '';

        if (!$email || !$password) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Invalid email or password'], 400);
        }

        $stmt = $pdo->prepare("SELECT u.id, u.name, u.email, u.role, u.created_at, u.password_hash,
                               p.phone, p.shipping_address, p.billing_address, p.avatar, p.account_status" .
                               (hasColumn($pdo, 'users', 'discount_pin') ? ", u.discount_pin" : "") .
                               " FROM users u
                               LEFT JOIN user_profiles p ON u.id = p.user_id
                               WHERE u.email = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        // SECURITY IMPERATIVE: Prevent user enumeration by returning a generic error message
        if (!$user || !password_verify($password, $user['password_hash'])) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Invalid email or password'], 401);
        }

        $jwtPayload = [
            'sub' => $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'avatar' => $user['avatar'] ?: '/assets/u1.svg',
            'role' => $user['role'] === 'admin' ? 'admin' : 'authenticated'
        ];
        $token = jwtGenerate($jwtPayload, 86400);

        setcookie('token', $token, [
            'expires' => time() + 86400,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);

        unset($user['password_hash']);

        out([
            'ok' => true,
            'success' => true,
            'message' => 'Logged in successfully',
            'token' => $token,
            'user' => [
                'id' => $user['id'],
                'name' => $user['name'],
                'email' => $user['email'],
                'role' => $user['role'],
                'phone' => $user['phone'] ?? '',
                'address' => $user['shipping_address'] ?? '',
                'shippingAddress' => $user['shipping_address'] ?? '',
                'billingAddress' => $user['billing_address'] ?? '',
                'avatar' => $user['avatar'] ?? '/assets/u1.svg',
                'accountStatus' => $user['account_status'] ?? 'Active Member',
                'createdAt' => $user['created_at'],
                'discountPin' => $user['discount_pin'] ?? null
            ]
        ]);
    }

    if ($action === 'logout') {
        setcookie('token', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        out(['ok'=>true, 'success'=>true, 'message'=>'Logged out successfully']);
    }

    if ($action === 'profile') {
        $authUser = getAuthenticatedUser($pdo);
        if (!$authUser) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Unauthorized session'], 401);
        }

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $data = bodyJson();
            $name = trim($data['name'] ?? $authUser['name']);
            $phone = trim($data['phone'] ?? $authUser['phone']);
            $shippingAddress = trim($data['shipping_address'] ?? $data['shippingAddress'] ?? $authUser['shipping_address']);
            $billingAddress = trim($data['billing_address'] ?? $data['billingAddress'] ?? $authUser['billing_address']);
            $avatar = trim($data['avatar'] ?? $authUser['avatar']);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("UPDATE users SET name = ? WHERE id = ?");
            $stmt->execute([$name, $authUser['id']]);

            $stmt = $pdo->prepare("INSERT INTO user_profiles (user_id, phone, shipping_address, billing_address, avatar, account_status)
                                   VALUES (?, ?, ?, ?, ?, 'Active Member')
                                   ON DUPLICATE KEY UPDATE phone = ?, shipping_address = ?, billing_address = ?, avatar = ?");
            $stmt->execute([$authUser['id'], $phone, $shippingAddress, $billingAddress, $avatar, $phone, $shippingAddress, $billingAddress, $avatar]);
            $pdo->commit();

            $authUser['name'] = $name;
            $authUser['phone'] = $phone;
            $authUser['shipping_address'] = $shippingAddress;
            $authUser['billing_address'] = $billingAddress;
            $authUser['avatar'] = $avatar;
        }

        unset($authUser['password_hash']);
        out([
            'ok' => true,
            'success' => true,
            'user' => [
                'id' => $authUser['id'],
                'name' => $authUser['name'],
                'email' => $authUser['email'],
                'role' => $authUser['role'],
                'phone' => $authUser['phone'] ?? '',
                'address' => $authUser['shipping_address'] ?? '',
                'shippingAddress' => $authUser['shipping_address'] ?? '',
                'billingAddress' => $authUser['billing_address'] ?? '',
                'avatar' => $authUser['avatar'] ?? '/assets/u1.svg',
                'accountStatus' => $authUser['account_status'] ?? 'Active Member',
                'createdAt' => $authUser['created_at']
            ]
        ]);
    }

    if ($action === 'change_password' || $action === 'change-password') {
        $authUser = getAuthenticatedUser($pdo);
        if (!$authUser) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Unauthorized session'], 401);
        }

        $data = bodyJson();
        $currentPassword = $data['current_password'] ?? '';
        $newPassword = $data['new_password'] ?? '';
        $confirmPassword = $data['confirm_new_password'] ?? $data['confirm_password'] ?? '';

        if (!password_verify($currentPassword, $authUser['password_hash'])) {
            out(['ok'=>false, 'success'=>false, 'message'=>'Current password is incorrect'], 400);
        }

        $pwCheck = validatePasswordComplexity($newPassword);
        if (!$pwCheck['valid']) {
            out(['ok'=>false, 'success'=>false, 'message'=>$pwCheck['message']], 400);
        }

        if ($newPassword !== $confirmPassword) {
            out(['ok'=>false, 'success'=>false, 'message'=>'New password and confirmation do not match'], 400);
        }

        $newHash = password_hash($newPassword, PASSWORD_BCRYPT);
        $stmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $stmt->execute([$newHash, $authUser['id']]);

        out(['ok'=>true, 'success'=>true, 'message'=>'Password changed successfully']);
    }

    /* --- STORE DATA MANAGEMENT ENDPOINTS --- */

    if ($action === 'load') {
        /* DATA SEPARATION: the catalog is public, but the customer directory
           and the full order book are admin-only. A signed-in customer only
           ever receives their own orders; a guest receives none. */
        $authUser = getAuthenticatedUser($pdo);
        $isAdmin = $authUser && ($authUser['role'] ?? '') === 'admin';

        $cats = [];
        foreach ($pdo->query("SELECT id,name,cover_image FROM categories ORDER BY created_at,id") as $r) {
            $cats[] = ['id'=>$r['id'],'name'=>$r['name'],'coverImage'=>$r['cover_image']];
        }

        $products = [];
        $stmt = $pdo->query("SELECT * FROM products ORDER BY created_at,id");
        foreach ($stmt as $r) {
            $products[] = [
                'id'=>$r['id'],'title'=>$r['title'],'category'=>$r['category_id'],
                'categoryName'=>$r['category_name'],'price'=>(float)$r['price'],
                'discountPrice'=>$r['discount_price']===null?null:(float)$r['discount_price'],
                'stock'=>(int)$r['stock'],'colors'=>arr($r['colors']),'sizes'=>arr($r['sizes']),
                'images'=>arr($r['images']),'rating'=>(string)$r['rating'],
                'reviewsCount'=>(int)$r['reviews_count'],'tags'=>arr($r['tags']),
                'description'=>$r['description'],'priceUpdatedAt'=>$r['price_updated_at']
            ];
        }

        $users = [];
        $orders = [];
        if ($isAdmin) {
            /* Admin dashboard view: every account (password hashes stripped) and
               the complete order book. */
            $includePin = hasColumn($pdo, 'users', 'discount_pin');
            $queryUsers = $pdo->query("SELECT u.id, u.name, u.email, u.role, u.promo, u.created_at,
                                        p.phone, p.shipping_address, p.billing_address, p.avatar, p.account_status" .
                                        ($includePin ? ", u.discount_pin" : "") .
                                        " FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id ORDER BY u.created_at, u.id");
            foreach ($queryUsers as $r) {
                $users[] = [
                    'id'=>$r['id'], 'name'=>$r['name'], 'email'=>$r['email'],
                    'phone'=>$r['phone']??'', 'address'=>$r['shipping_address']??'',
                    'shippingAddress'=>$r['shipping_address']??'', 'billingAddress'=>$r['billing_address']??'',
                    'avatar'=>$r['avatar']??'/assets/u1.svg', 'accountStatus'=>$r['account_status']??'Active Member',
                    'role'=>$r['role'], 'promo'=>(bool)$r['promo'], 'createdAt'=>$r['created_at'],
                    'discountPin'=>$r['discount_pin'] ?? null
                ];
            }

            foreach ($pdo->query("SELECT id,user_id,items,subtotal,delivery,total,status,shipping,created_at FROM orders ORDER BY created_at DESC") as $r) {
                $orders[] = ['id'=>$r['id'],'userId'=>$r['user_id'],'items'=>arr($r['items']),
                    'subtotal'=>(float)$r['subtotal'],'delivery'=>(float)$r['delivery'],'total'=>(float)$r['total'],
                    'status'=>$r['status'],'shipping'=>arr($r['shipping']),'createdAt'=>(int)$r['created_at']];
            }
        } elseif ($authUser) {
            /* Customer view: ONLY this account's own order history. */
            $stmt = $pdo->prepare("SELECT id,user_id,items,subtotal,delivery,total,status,shipping,created_at
                                   FROM orders WHERE user_id = ? ORDER BY created_at DESC");
            $stmt->execute([$authUser['id']]);
            foreach ($stmt as $r) {
                $orders[] = ['id'=>$r['id'],'userId'=>$r['user_id'],'items'=>arr($r['items']),
                    'subtotal'=>(float)$r['subtotal'],'delivery'=>(float)$r['delivery'],'total'=>(float)$r['total'],
                    'status'=>$r['status'],'shipping'=>arr($r['shipping']),'createdAt'=>(int)$r['created_at']];
            }
        }

        $reviews = [];
        foreach ($pdo->query("SELECT id,product_id,user_id,user_name,rating,comment,approved,created_at FROM reviews ORDER BY created_at DESC") as $r) {
            $reviews[] = ['id'=>(string)$r['id'],'productId'=>$r['product_id'],'userId'=>$r['user_id'],
                'userName'=>$r['user_name'],'rating'=>(int)$r['rating'],'comment'=>$r['comment'],
                'approved'=>(bool)$r['approved'],'createdAt'=>(int)$r['created_at']];
        }

        out(['ok'=>true,'data'=>['categories'=>$cats,'products'=>$products,'orders'=>$orders,'reviews'=>$reviews,'users'=>$users]]);
    }

    if ($action === 'prices') {
        $prices = [];
        foreach ($pdo->query("SELECT id,price,discount_price,price_updated_at FROM products") as $r) {
            $prices[] = ['id'=>$r['id'],'price'=>(float)$r['price'],
                'discountPrice'=>$r['discount_price']===null?null:(float)$r['discount_price'],
                'updatedAt'=>$r['price_updated_at']];
        }
        out(['ok'=>true,'prices'=>$prices]);
    }

    if ($action === 'save') {
        /* SERVER-SIDE PROTECTION: only an administrator may rewrite the store
           (catalog, inventory, users, orders). Customers get a 403. */
        requireAdmin($pdo);

        $data = bodyJson();
        foreach (['categories','products','users','orders','reviews'] as $key) {
            if (!isset($data[$key]) || !is_array($data[$key])) $data[$key] = [];
        }

        $pdo->beginTransaction();
        $pdo->exec("DELETE FROM order_items");
        $pdo->exec("DELETE FROM orders");
        $pdo->exec("DELETE FROM reviews");
        $pdo->exec("DELETE FROM products");
        $pdo->exec("DELETE FROM categories");
        /* users / user_profiles are deliberately NOT deleted: accounts are
           upserted below so bcrypt password hashes and admin seeds survive. */

        $includePin = hasColumn($pdo, 'users', 'discount_pin');
        $userSql = $includePin
            ? "INSERT INTO users(id,name,email,password_hash,role,promo,discount_pin) VALUES(?,?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), promo=VALUES(promo), discount_pin=VALUES(discount_pin)"
            : "INSERT INTO users(id,name,email,password_hash,role,promo) VALUES(?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), promo=VALUES(promo)";
        $qUser = $pdo->prepare($userSql);
        $qProf = $pdo->prepare("INSERT INTO user_profiles(user_id,phone,shipping_address,billing_address,avatar,account_status) VALUES(?,?,?,?,?,?)
                                ON DUPLICATE KEY UPDATE phone=VALUES(phone), shipping_address=VALUES(shipping_address),
                                billing_address=VALUES(billing_address), avatar=VALUES(avatar), account_status=VALUES(account_status)");
        foreach ($data['users'] as $u) {
            $userId = $u['id'] ?? ('U'.uniqid());
            // Keep an existing hash unless the caller supplies one; a brand-new
            // row with no credentials gets an unusable random hash (reset only).
            if (!empty($u['passwordHash'])) {
                $hash = $u['passwordHash'];
            } elseif (!empty($u['password'])) {
                $hash = password_hash($u['password'], PASSWORD_BCRYPT);
            } else {
                $hash = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT);
            }
            $args = [$userId, $u['name']??'', $u['email']??'', $hash, $u['role']??'customer', !empty($u['promo'])?1:0];
            if ($includePin) $args[] = $u['discountPin'] ?? null;
            $qUser->execute($args);
            $qProf->execute([$userId, $u['phone']??'', $u['shippingAddress']??$u['address']??'', $u['billingAddress']??$u['address']??'', $u['avatar']??'/assets/u1.svg', $u['accountStatus']??'Active Member']);
        }

        $q = $pdo->prepare("INSERT INTO categories(id,name,cover_image) VALUES(?,?,?)");
        foreach ($data['categories'] as $c) $q->execute([$c['id'],$c['name'],$c['coverImage']??null]);

        $q = $pdo->prepare("INSERT INTO products(id,title,category_id,category_name,price,discount_price,stock,colors,sizes,images,rating,reviews_count,tags,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        foreach ($data['products'] as $p) {
            $q->execute([$p['id'],$p['title'],$p['category'],$p['categoryName']??'',
                $p['price']??0,$p['discountPrice']??null,$p['stock']??0,
                json_encode($p['colors']??[],JSON_UNESCAPED_UNICODE),json_encode($p['sizes']??[],JSON_UNESCAPED_UNICODE),
                json_encode($p['images']??[],JSON_UNESCAPED_UNICODE),$p['rating']??4.5,$p['reviewsCount']??0,
                json_encode($p['tags']??[],JSON_UNESCAPED_UNICODE),$p['description']??'']);
        }

        $q = $pdo->prepare("INSERT INTO orders(id,user_id,items,subtotal,delivery,total,status,shipping,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
        foreach ($data['orders'] as $o) {
            $q->execute([$o['id'],$o['userId']??null,json_encode($o['items']??[],JSON_UNESCAPED_UNICODE),
                $o['subtotal']??0,$o['delivery']??0,$o['total']??0,$o['status']??'Pending',
                json_encode($o['shipping']??[],JSON_UNESCAPED_UNICODE),$o['createdAt']??round(microtime(true)*1000)]);
        }

        $q = $pdo->prepare("INSERT INTO reviews(product_id,user_id,user_name,rating,comment,approved,created_at) VALUES(?,?,?,?,?,?,?)");
        foreach ($data['reviews'] as $r) {
            $q->execute([$r['productId'],$r['userId']??null,$r['userName']??'',$r['rating']??5,
                $r['comment']??'',isset($r['approved'])&&$r['approved']===false?0:1,$r['createdAt']??round(microtime(true)*1000)]);
        }

        $pdo->commit();
        out(['ok'=>true,'message'=>'Database saved']);
    }

    /* --- ORDER PERSISTENCE (available to customers and guests) --- */
    if ($action === 'create_order') {
        $authUser = getAuthenticatedUser($pdo);
        $o = bodyJson();

        $orderId = trim($o['id'] ?? '');
        $items = is_array($o['items'] ?? null) ? $o['items'] : [];
        if ($orderId === '' || !$items) {
            out(['ok'=>false,'success'=>false,'message'=>'Order id and items are required'], 400);
        }

        // Ownership: the order belongs to the authenticated account, otherwise
        // it is stored as a guest order (user_id NULL) — never to a client-
        // supplied id, so nobody can attach orders to someone else's account.
        $userId = $authUser ? $authUser['id'] : null;
        $subtotal = (float)($o['subtotal'] ?? 0);
        $delivery = (float)($o['delivery'] ?? 0);
        $total = (float)($o['total'] ?? 0);
        $status = (string)($o['status'] ?? 'Pending');
        $shipping = json_encode($o['shipping'] ?? [], JSON_UNESCAPED_UNICODE);
        $createdAt = (int)($o['createdAt'] ?? round(microtime(true) * 1000));

        $stmt = $pdo->prepare("INSERT INTO orders(id,user_id,items,subtotal,delivery,total,status,shipping,created_at)
                               VALUES(?,?,?,?,?,?,?,?,?)
                               ON DUPLICATE KEY UPDATE status=VALUES(status)");
        $stmt->execute([$orderId, $userId, json_encode($items, JSON_UNESCAPED_UNICODE),
            $subtotal, $delivery, $total, $status, $shipping, $createdAt]);

        out(['ok'=>true,'success'=>true,'orderId'=>$orderId,'userId'=>$userId]);
    }

    /* --- GOOGLE SIGN-UP / SIGN-IN (Google Identity Services) ---
       The ID token is verified against Google's tokeninfo endpoint, which
       checks the signature, the issuer and that it was issued for OUR client
       id. A token is never trusted from the request body alone. */
    if ($action === 'google_auth') {
        if (!defined('GOOGLE_CLIENT_ID') || GOOGLE_CLIENT_ID === '') {
            out(['ok'=>false,'success'=>false,
                 'message'=>'Google Sign-In is not configured: set GOOGLE_CLIENT_ID in api/config.php'], 503);
        }

        $data = bodyJson();
        $credential = trim($data['credential'] ?? '');
        if ($credential === '') {
            out(['ok'=>false,'success'=>false,'message'=>'Missing Google credential'], 400);
        }

        $info = @file_get_contents('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($credential));
        if ($info === false) {
            out(['ok'=>false,'success'=>false,'message'=>'Could not verify the Google token'], 502);
        }
        $g = json_decode($info, true);
        if (!is_array($g)) {
            out(['ok'=>false,'success'=>false,'message'=>'Invalid Google token'], 401);
        }

        $audienceOk = (($g['aud'] ?? '') === GOOGLE_CLIENT_ID);
        $issuerOk = isset($g['iss']) && strpos($g['iss'], 'accounts.google.com') !== false;
        $emailVerified = in_array($g['email_verified'] ?? '', ['1', 'true'], true);
        $notExpired = empty($g['exp']) || (int)$g['exp'] >= time();
        if (!$audienceOk || !$issuerOk || !$emailVerified || !$notExpired) {
            out(['ok'=>false,'success'=>false,'message'=>'Google token rejected (audience/issuer/expiry check failed)'], 401);
        }

        $email = strtolower(trim($g['email'] ?? ''));
        $name = trim($g['name'] ?? '');
        $avatar = trim($g['picture'] ?? '');
        if ($email === '') {
            out(['ok'=>false,'success'=>false,'message'=>'Google account has no email address'], 400);
        }

        $stmt = $pdo->prepare("SELECT u.id, u.name, u.email, u.role, u.created_at, p.avatar,
                               p.phone, p.shipping_address, p.billing_address, p.account_status" .
                               (hasColumn($pdo, 'users', 'discount_pin') ? ", u.discount_pin" : "") .
                               " FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id WHERE u.email = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        $isNew = false;

        if (!$user) {
            // First-time Google sign-up: role defaults to "customer" and a
            // first-order discount PIN is stored with the account.
            $isNew = true;
            $userId = 'U' . uniqid();
            $pinSql = hasColumn($pdo, 'users', 'discount_pin');
            $discountPin = trim($data['discount_pin'] ?? '');
            $pdo->beginTransaction();
            if ($pinSql) {
                $ins = $pdo->prepare("INSERT INTO users(id,name,email,password_hash,role,promo,discount_pin) VALUES(?,?,?,?,?,?,?)");
                $ins->execute([$userId, $name !== '' ? $name : $email, $email,
                    password_hash(bin2hex(random_bytes(24)), PASSWORD_BCRYPT), 'customer', 1, $discountPin !== '' ? $discountPin : null]);
            } else {
                $ins = $pdo->prepare("INSERT INTO users(id,name,email,password_hash,role,promo) VALUES(?,?,?,?,?,?)");
                $ins->execute([$userId, $name !== '' ? $name : $email, $email,
                    password_hash(bin2hex(random_bytes(24)), PASSWORD_BCRYPT), 'customer', 1]);
            }
            $pdo->prepare("INSERT INTO user_profiles(user_id,phone,shipping_address,billing_address,avatar,account_status)
                           VALUES(?,?,'','',?,'Active Member')")
                ->execute([$userId, '', $avatar !== '' ? $avatar : '/assets/u1.svg']);
            $pdo->commit();
            $stmt->execute([$email]);
            $user = $stmt->fetch();
        }

        $jwtPayload = [
            'sub' => $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'avatar' => $user['avatar'] ?: ($avatar !== '' ? $avatar : '/assets/u1.svg'),
            'role' => ($user['role'] ?? 'customer') === 'admin' ? 'admin' : 'authenticated'
        ];
        $token = jwtGenerate($jwtPayload, 86400);
        setcookie('token', $token, [
            'expires' => time() + 86400,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);

        out([
            'ok'=>true, 'success'=>true, 'isNew'=>$isNew, 'token'=>$token,
            'message'=>$isNew ? 'Welcome to NoFrame' : 'Welcome back',
            'user' => [
                'id'=>$user['id'], 'name'=>$user['name'], 'email'=>$user['email'],
                'role'=>$user['role'] ?? 'customer',
                'phone'=>$user['phone'] ?? '',
                'address'=>$user['shipping_address'] ?? '',
                'shippingAddress'=>$user['shipping_address'] ?? '',
                'billingAddress'=>$user['billing_address'] ?? '',
                'avatar'=>$user['avatar'] ?? '/assets/u1.svg',
                'accountStatus'=>$user['account_status'] ?? 'Active Member',
                'createdAt'=>$user['created_at'],
                'discountPin'=>$user['discount_pin'] ?? null
            ]
        ]);
    }

    out(['ok'=>false,'message'=>'Unknown action'], 400);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    out(['ok'=>false,'message'=>$e->getMessage()], 500);
}
