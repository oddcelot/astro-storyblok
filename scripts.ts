#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";

program.version("0.0.1").description("");


program.action(() => {
  inquirer

    .prompt([
      {
        type: "list",
        name: "env",
        message: "Select your target env",
        choices: ["dev", "uat", "prod"],
      },
      // {
      //   type: "input",
      //   name: "name",
      //   message: "What's your name?",
      // },
    ])
    .then(selection => {
      console.log(chalk.bgBlue.red(`Hey there, ${selection.env}!`));
    })
    // .then((answers) => {
    //   console.log(chalk.bgBlue.red(`Hey there, ${answers.name}!`));
    // });
});

program.parse(process.argv);
