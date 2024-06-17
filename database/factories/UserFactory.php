<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

class UserFactory extends Factory
{
    protected $model = User::class;

    public function definition()
    {
        return [
            'card_number' => $this->faker->creditCardNumber,
            'pin' => Hash::make('1234'),
            'balance' => $this->faker->numberBetween(0, 10000),
        ];
    }
}
