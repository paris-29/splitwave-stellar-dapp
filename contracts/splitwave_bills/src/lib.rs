#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    TargetMustBePositive = 1,
    AmountMustBePositive = 2,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Bill(String),
    Payment(String, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct BillSummary {
    pub id: String,
    pub title: String,
    pub target: i128,
    pub paid: i128,
    pub contributors: u32,
    pub updated_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PaymentRecord {
    pub amount: i128,
    pub memo: String,
    pub updated_ledger: u32,
}

#[contract]
pub struct SplitwaveBills;

#[contractimpl]
impl SplitwaveBills {
    pub fn upsert_bill(
        env: Env,
        owner: Address,
        id: String,
        title: String,
        target: i128,
    ) -> Result<BillSummary, Error> {
        owner.require_auth();

        if target <= 0 {
            return Err(Error::TargetMustBePositive);
        }

        let key = DataKey::Bill(id.clone());
        let mut summary = read_bill(&env, id.clone());
        summary.title = title;
        summary.target = target;
        summary.updated_ledger = env.ledger().sequence();

        env.storage().persistent().set(&key, &summary);
        env.events()
            .publish((symbol_short!("bill"), id, owner), summary.target);

        Ok(summary)
    }

    pub fn record_payment(
        env: Env,
        bill_id: String,
        from: Address,
        amount: i128,
        memo: String,
    ) -> Result<BillSummary, Error> {
        from.require_auth();

        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }

        let bill_key = DataKey::Bill(bill_id.clone());
        let payment_key = DataKey::Payment(bill_id.clone(), from.clone());
        let mut summary = read_bill(&env, bill_id.clone());
        let mut payment = read_payment(&env, bill_id.clone(), from.clone());

        if payment.amount == 0 {
            summary.contributors += 1;
        }

        payment.amount += amount;
        payment.memo = memo;
        payment.updated_ledger = env.ledger().sequence();
        summary.paid += amount;
        summary.updated_ledger = env.ledger().sequence();

        env.storage().persistent().set(&payment_key, &payment);
        env.storage().persistent().set(&bill_key, &summary);
        env.events()
            .publish((symbol_short!("pay"), bill_id, from), amount);

        Ok(summary)
    }

    pub fn summary(env: Env, bill_id: String) -> BillSummary {
        read_bill(&env, bill_id)
    }

    pub fn contribution(env: Env, bill_id: String, from: Address) -> PaymentRecord {
        read_payment(&env, bill_id, from)
    }
}

fn read_bill(env: &Env, bill_id: String) -> BillSummary {
    env.storage()
        .persistent()
        .get(&DataKey::Bill(bill_id.clone()))
        .unwrap_or(BillSummary {
            id: bill_id,
            title: String::from_str(env, "Daily bill"),
            target: 0,
            paid: 0,
            contributors: 0,
            updated_ledger: env.ledger().sequence(),
        })
}

fn read_payment(env: &Env, bill_id: String, from: Address) -> PaymentRecord {
    env.storage()
        .persistent()
        .get(&DataKey::Payment(bill_id, from))
        .unwrap_or(PaymentRecord {
            amount: 0,
            memo: String::from_str(env, ""),
            updated_ledger: env.ledger().sequence(),
        })
}
