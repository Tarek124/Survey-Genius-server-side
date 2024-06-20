require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//secret key
const secretKey = process.env.SECRET_KEY;

// middleware
app.use(cors());
app.use(express.json());

// custom middleware
//verify token
const verifyToken = (req, res, next) => {
  if (!req.headers.token) {
    return res.status(401).send({ message: "unauthorized user" });
  }
  jwt.verify(req.headers.token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized user" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.83drhwd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    const userCollection = client.db("assignment-12").collection("users");
    const surveysCollection = client.db("assignment-12").collection("surveys");
    const paymentCollection = client.db("assignment-12").collection("payments");
    const commentCollection = client.db("assignment-12").collection("comments");
    const votesCollection = client.db("assignment-12").collection("votes");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, secretKey, { expiresIn: "7d" });
      res.send({ token });
    });

    //user related apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existUser = await userCollection.findOne(query);
      if (existUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.get("/userRole", async (req, res) => {
      const { email } = req.query;
      const query = { email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    //all survey
    app.get("/allsurveys", async (req, res) => {
      const result = await surveysCollection.find().toArray();
      res.send(result);
    });
    //survey details
    app.get("/detail", async (req, res) => {
      const { email, id } = req.query;

      console.log("ID:", id);
      console.log("Email:", email);

      // Validate ID and email presence
      if (!id || !email) {
        return res.status(400).send({ message: "Invalid request parameters" });
      }

      const voteQuery = { surveyId: id, userEmail: email };

      try {
        const findVote = await votesCollection.findOne(voteQuery);
        const query = { _id: new ObjectId(id) };
        const result = await surveysCollection.findOne(query);

        if (findVote) {
          return res.send({ ...result, voted: true });
        }
        return res.send(result);
      } catch (error) {
        console.error("Error fetching data:", error);
        return res.status(500).send({ message: "Internal server error" });
      }
    });

    // Route to get latest surveys
    app.get("/api/latest-surveys", async (req, res) => {
      try {
        const surveys = await surveysCollection
          .find()
          .sort({ created_at: -1 })
          .limit(6)
          .toArray();
        res.send(surveys);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    // payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      if (amount > 1) {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send(paymentIntent.client_secret);
      }
    });

    app.post("/payment", async (req, res) => {
      const payment = req.body;

      const query = { email: payment.email };

      const paymentResult = await paymentCollection.insertOne(payment);
      if (paymentResult.insertedId) {
        // Update the user's role
        const update = { $set: { role: "pro-user" } }; // Replace 'newRole' with the desired role
        await userCollection.updateOne(query, update);
        res.send({ paymentResult, message: "User role updated" });
      } else {
        res.status(500).json({ message: "Failed to insert payment" });
      }
    });
    //comments
    app.post("/comment", async (req, res) => {
      const data = req.body;
      const result = await commentCollection.insertOne(data);
      res.send(result);
    });
    app.get("/comments", async (req, res) => {
      const { id } = req.query;
      const query = { surveyId: id };
      const result = await commentCollection.find(query).toArray();
      res.send(result);
    });

    //Submit Votes
    app.post("/submitVote", async (req, res) => {
      const data = req.body;
      const query = { _id: new ObjectId(data.surveyId) };

      const voteQuery = { surveyId: data.surveyId, userEmail: data.userEmail };
      const findVote = await votesCollection.findOne(voteQuery);
      if (findVote) {
        return res.send({ message: "you already voted" });
      }
      const update = {
        $set: { options: data.optionVote, votes: data.totalVotes },
      };
      const result = await surveysCollection.updateOne(query, update);
      res.send(result);

      const voteData = { surveyId: data.surveyId, userEmail: data.userEmail };
      const insertVote = await votesCollection.insertOne(voteData);
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`http://localhost:${port}`);
});
