<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nueva transacción</title>
</head>
<body>
    <h1>Nueva transacción</h1>
    <form method="POST" action="{{ route('transactions.store') }}">
        @csrf
        <div>
            <label for="receiver_card_number">Número de tarjeta del destinatario:</label>
            <input type="text" id="receiver_card_number" name="receiver_card_number" required>
        </div>
        <div>
            <label for="amount">Monto:</label>
            <input type="number" id="amount" name="amount" required>
        </div>
        <button type="submit">Transferir</button>
    </form>
</body>
</html>
