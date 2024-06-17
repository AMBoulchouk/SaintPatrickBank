<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Transaction extends Model
{
    protected $fillable = ['user_id', 'receiver_card_number', 'amount'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

