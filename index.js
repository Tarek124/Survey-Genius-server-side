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
  console.log(req.headers.token);
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
    const unpublishedSurveysCollection = client
      .db("assignment-12")
      .collection("unpublishedSurveys");
    const paymentCollection = client.db("assignment-12").collection("payments");
    const commentCollection = client.db("assignment-12").collection("comments");
    const votesCollection = client.db("assignment-12").collection("votes");
    const reportsCollection = client.db("assignment-12").collection("reports");

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
    app.get("/admin/allUsers", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //all survey
    app.get("/allsurveys", async (req, res) => {
      const result = await surveysCollection.find().toArray();
      res.send(result);
    });

    //unpublished Surveys
    app.get("/unpublished", async (req, res) => {
      const result = await unpublishedSurveysCollection.find().toArray();
      res.send(result);
    });

    //create survey
    app.post("/surveyor/create", async (req, res) => {
      const data = req.body;
      const result = await surveysCollection.insertOne(data);
      res.send(result);
    });

    app.post("/handleSurveys", async (req, res) => {
      const data = req.body;
      if (data?.condition === "publish") {
        const query = { _id: new ObjectId(data.id) };
        const find = await unpublishedSurveysCollection.findOne(query);
        const setData = await surveysCollection.insertOne(find);
        if (setData.insertedId) {
          const deleteUnpublishedSurveys =
            await unpublishedSurveysCollection.deleteOne(query);
          return res.send(deleteUnpublishedSurveys);
        }
      }

      const query = { _id: new ObjectId(data.id) };
      const find = await surveysCollection.findOne(query);
      const setData = await unpublishedSurveysCollection.insertOne(find);
      if (setData.insertedId) {
        const deleteUnpublishedSurveys = await surveysCollection.deleteOne(
          query
        );
        return res.send(deleteUnpublishedSurveys);
      }
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

    // Route to get most voted surveys
    app.get("/api/most-voted-surveys", async (req, res) => {
      try {
        const surveys = await surveysCollection
          .find()
          .sort({ votes: -1 })
          .limit(6)
          .toArray();
        res.json(surveys);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
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
    app.get("/user/comments", async (req, res) => {
      const { name } = req.query;
      const query = { name };
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

      const voteData = {
        surveyId: data.surveyId,
        userEmail: data.userEmail,
        time: data.time,
        response: data.response,
        title: data.title,
      };
      const insertVote = await votesCollection.insertOne(voteData);
    });
    app.get("/admin/votesAndPayments", async (req, res) => {
      const votes = await votesCollection.find().toArray();
      const payments = await paymentCollection.find().toArray();
      res.send({ payments, votes });
    });

    //roport related api
    app.post("/report", async (req, res) => {
      const reportData = req.body;
      const result = await reportsCollection.insertOne(reportData);
      res.send(result);
    });
    app.get("/reports", async (req, res) => {
      const { email } = req.query;
      const query = { email };
      const result = await reportsCollection.find(query).toArray();

      res.send(result);
    });
    // admin change the role
    app.post("/admin/role", async (req, res) => {
      const { role, userId } = req.body;
      const query = { _id: new ObjectId(userId) };
      const update = {
        $set: { role },
      };
      const result = await userCollection.updateOne(query, update);
      res.send(result);
    });

    //surveyor surveys
    app.get("/surveyor/survey", async (req, res) => {
      const { id } = req.query;
      const query = { _id: new ObjectId(id) };
      const result = await surveysCollection.findOne(query);
      res.send(result);
    });
    //update survey
    app.post("/surveyor/update", async (req, res) => {
      const { category, updatedBy, deadline, description, id, title } =
        req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: { category, updatedBy, deadline, description, title },
      };
      const result = await surveysCollection.updateOne(query, update);
      res.send(result);
    });
    app.get("/surveyor/allSurvey", async (req, res) => {
      const { email } = req.query;
      const updatedBy = { updatedBy: email };
      const createdBy = { createdBy: email };
      if (email) {
        const updatedBypublish = await surveysCollection
          .find(updatedBy)
          .toArray();
        const updatedByunpublish = await unpublishedSurveysCollection
          .find(updatedBy)
          .toArray();
        const createdBypublish = await surveysCollection
          .find(createdBy)
          .toArray();
        const createdByunpublish = await unpublishedSurveysCollection
          .find(createdBy)
          .toArray();
        const updated = [...updatedBypublish, ...updatedByunpublish];
        const created = [...createdBypublish, ...createdByunpublish];
        res.send({ updated, created });
      }
    });
  } finally {
  }
}
run().catch(console.dir)

app.listen(port, () => {
  console.log(`http://localhost:${port}`);
});
