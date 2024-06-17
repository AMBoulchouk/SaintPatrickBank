<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transactions</title>
</head>
<body>
    <h1>Transactions</h1>
    @if ($transactions->isEmpty())
        <p>No transactions found.</p>
    @else
        <ul>
            @foreach ($transactions as $transaction)
                <li>
                    To: {{ $transaction->receiver_card_number }} - Amount: ${{ $transaction->amount }}
                </li>
            @endforeach
        </ul>
    @endif
    <a href="{{ route('transactions.create') }}">New Transaction</a>
    <br>
    <a href="{{ route('home') }}">Home</a>
</body>
</html>
