<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login</title>
</head>
<body>
    <h1>Login</h1>
    @if ($errors->any())
        <div>
            <ul>
                @foreach ($errors->all() as $error)
                    <li>{{ $error }}</li>
                @endforeach
            </ul>
        </div>
    @endif
    <form method="POST" action="{{ route('login') }}">
        @csrf
        <div>
            <label for="card_number">Número de tarjeta:</label>
            <input type="text" id="card_number" name="card_number" required>
        </div>
        <div>
            <label for="pin">PIN:</label>
            <input type="password" id="pin" name="pin" required>
        </div>
        <button type="submit">Login</button>
    </form>
</body>
</html>
