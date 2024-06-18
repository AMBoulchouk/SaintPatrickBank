<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nueva transacción - Saint Patrick Bank</title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,600&display=swap" rel="stylesheet" />

    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="font-sans antialiased dark:bg-black dark:text-white/50">
    <div class="bg-gray-50 text-black/50 dark:bg-black dark:text-white/50 min-h-screen flex flex-col justify-center items-center">
        <div class="w-full max-w-md px-6 lg:max-w-lg">
            <header class="py-10">
                <h1 class="text-3xl font-semibold text-center text-black dark:text-white">Nueva transacción</h1>
            </header>

            <div class="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-md ring-1 ring-gray-200 dark:ring-gray-700">
                <form method="POST" action="{{ route('transactions.store') }}" class="space-y-6">
                    @csrf
                    <div>
                        <label for="receiver_card_number" class="block text-sm font-medium text-black dark:text-white">Número de tarjeta del destinatario:</label>
                        <input type="text" id="receiver_card_number" name="receiver_card_number" required class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#FF2D20] focus:border-[#FF2D20] dark:bg-zinc-800 dark:border-zinc-700 dark:placeholder-zinc-400 dark:text-white dark:focus:ring-[#FF2D20] dark:focus:border-[#FF2D20]">
                    </div>
                    <div>
                        <label for="amount" class="block text-sm font-medium text-black dark:text-white">Monto:</label>
                        <input type="number" id="amount" name="amount" required class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#FF2D20] focus:border-[#FF2D20] dark:bg-zinc-800 dark:border-zinc-700 dark:placeholder-zinc-400 dark:text-white dark:focus:ring-[#FF2D20] dark:focus:border-[#FF2D20]">
                    </div>
                    <button type="submit" class="w-full py-2 px-4 rounded-md text-white bg-[#FF2D20] hover:bg-[#FF4D40] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF2D20]">Transferir</button>
                </form>
            </div>
        </div>
    </div>
</body>
</html>
