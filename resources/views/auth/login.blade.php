<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Saint Patrick Bank</title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,600&display=swap" rel="stylesheet" />

    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="font-sans antialiased dark:bg-black dark:text-white/50">
    <div class="bg-gray-50 text-black/50 dark:bg-black dark:text-white/50 min-h-screen flex flex-col justify-center items-center">
        <div class="w-full max-w-md px-6 lg:max-w-lg">
            <header class="py-10">
                <h1 class="text-3xl font-semibold text-center text-black dark:text-white">Login to Saint Patrick Bank</h1>
            </header>

            @if ($errors->any())
                <div class="mb-4 text-sm text-red-600 dark:text-red-400">
                    <ul>
                        @foreach ($errors->all() as $error)
                            <li>{{ $error }}</li>
                        @endforeach
                    </ul>
                </div>
            @endif

            <form method="POST" action="{{ route('login') }}" class="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-md ring-1 ring-gray-200 dark:ring-gray-700">
                @csrf
                <div class="mb-4">
                    <label for="card_number" class="block text-sm font-medium text-black dark:text-white">Número de tarjeta:</label>
                    <input type="text" id="card_number" name="card_number" required class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#FF2D20] focus:border-[#FF2D20] dark:bg-zinc-800 dark:border-zinc-600 dark:text-white">
                </div>
                <div class="mb-6">
                    <label for="pin" class="block text-sm font-medium text-black dark:text-white">PIN:</label>
                    <input type="password" id="pin" name="pin" required class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#FF2D20] focus:border-[#FF2D20] dark:bg-zinc-800 dark:border-zinc-600 dark:text-white">
                </div>
                <div class="flex items-center justify-between">
                    <button type="submit" class="w-full py-2 px-4 rounded-md text-white bg-[#FF2D20] hover:bg-[#FF4D40] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF2D20]">
                        Login
                    </button>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
