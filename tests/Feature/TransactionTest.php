<?php

namespace Tests\Feature;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TransactionTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_view_transactions()
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $response = $this->get('/transactions');
        $response->assertStatus(200);
    }

    public function test_user_can_create_transaction()
    {
        $user = User::factory()->create(['balance' => 5000]);
        $receiver = User::factory()->create(['card_number' => '5595-3458-9989-7125']);

        $this->actingAs($user);

        $response = $this->post('/transactions', [
            'receiver_card_number' => '5595-3458-9989-7125',
            'amount' => 1000,
        ]);

        $response->assertRedirect('/transactions');
        $this->assertDatabaseHas('transactions', [
            'user_id' => $user->id,
            'receiver_card_number' => '5595-3458-9989-7125',
            'amount' => 1000,
        ]);
    }
}
