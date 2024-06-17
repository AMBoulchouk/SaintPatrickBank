<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class UserSeeder extends Seeder
{
    public function run()
    {
        DB::table('users')->insert([
            [
                'card_number' => '4546-8574-1856-5565',
                'pin' => Hash::make('4345'),
                'balance' => 40555,
            ],
            [
                'card_number' => '5595-3458-9989-7125',
                'pin' => Hash::make('1595'),
                'balance' => 3566,
            ],
            [
                'card_number' => '4858-6696-5887-1578',
                'pin' => Hash::make('1234'),
                'balance' => 23,
            ],
            [
                'card_number' => '5854-6656-2587-1547',
                'pin' => Hash::make('4345'),
                'balance' => 300,
            ],
            [
                'card_number' => '4546-9896-2357-1478',
                'pin' => Hash::make('0023'),
                'balance' => 35621,
            ],
        ]);
    }
}
