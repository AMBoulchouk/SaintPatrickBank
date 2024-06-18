<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transactions - Saint Patrick Bank</title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,600&display=swap" rel="stylesheet" />

    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="font-sans antialiased dark:bg-black dark:text-white/50">
    <div class="bg-gray-50 text-black/50 dark:bg-black dark:text-white/50 min-h-screen flex flex-col justify-center items-center">
        <div class="w-full max-w-md px-6 lg:max-w-lg">
            <header class="py-10">
                <h1 class="text-3xl font-semibold text-center text-black dark:text-white">Transactions</h1>
            </header>

            <div class="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-md ring-1 ring-gray-200 dark:ring-gray-700">
                @if ($transactions->isEmpty())
                    <p class="mb-4 text-lg font-medium text-black dark:text-white">No transactions found.</p>
                @else
                    <ul class="mb-4">
                        @foreach ($transactions as $transaction)
                            <li class="mb-2 text-sm text-black dark:text-white">
                                To: {{ $transaction->receiver_card_number }} - Amount: ${{ $transaction->amount }}
                            </li>
                        @endforeach
                    </ul>
                @endif

                <a href="{{ route('transactions.create') }}" class="block mb-4 text-blue-600 dark:text-blue-400 hover:underline">
                    New Transaction
                </a>

                <a href="{{ route('home') }}" class="block text-blue-600 dark:text-blue-400 hover:underline">
                    Home
                </a>
            </div>
        </div>
    </div>
</body>
</html>
