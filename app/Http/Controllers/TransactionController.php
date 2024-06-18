<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class TransactionController extends Controller
{
    public function index()
    {
        $user = Auth::user();
        $transactions = Transaction::where('user_id', $user->id)->orderBy('created_at', 'desc')->get();

        return view('pages.transactions.index', compact('transactions'));
    }

    public function create()
    {
        return view('pages.transactions.create');
    }

    public function store(Request $request)
    {
        $request->validate([
            'receiver_card_number' => 'required|exists:users,card_number',
            'amount' => 'required|numeric|min:1',
        ]);

        $user = Auth::user();
        $receiver = User::where('card_number', $request->receiver_card_number)->first();

        if ($user->balance < $request->amount) {
            return back()->withErrors(['amount' => 'Saldo insuficiente']);
        }

        \DB::beginTransaction();

        try {
            $user->balance -= $request->amount;
            $user->save();

            $receiver->balance += $request->amount;
            $receiver->save();

            Transaction::create([
                'user_id' => $user->id,
                'receiver_card_number' => $request->receiver_card_number,
                'amount' => $request->amount,
            ]);

            \DB::commit();

            return redirect()->route('pages.transactions.index')->with('success', 'Transacción realizada con éxito');
        } catch (\Exception $e) {
            \DB::rollBack();

            \Log::error('Transaction failed: ' . $e->getMessage());

            return back()->withErrors(['error' => 'No pudo realizarse la transacción.']);
        }
    }
}
